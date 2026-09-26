import os
import uuid
from tempfile import NamedTemporaryFile

import chromadb
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from sentence_transformers import SentenceTransformer

from . import config

# Lazy-initialized singletons
_embedding_model = None
_chroma_client = None


def _get_embedding_model() -> SentenceTransformer:
    global _embedding_model
    if _embedding_model is None:
        _embedding_model = SentenceTransformer(config.EMBEDDING_MODEL_NAME)
    return _embedding_model


def _get_chroma_collection() -> chromadb.Collection:
    global _chroma_client
    if _chroma_client is None:
        os.makedirs(config.CHROMA_PERSIST_DIR, exist_ok=True)
        _chroma_client = chromadb.PersistentClient(path=config.CHROMA_PERSIST_DIR)
    return _chroma_client.get_or_create_collection(
        name=config.CHROMA_COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )


def ingest_pdf(file_bytes: bytes, filename: str) -> dict:
    """Parse PDF, chunk, embed, store in ChromaDB. Replaces old chunks for same file."""
    with NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    try:
        loader = PyPDFLoader(tmp_path)
        docs = loader.load()
        pages_processed = len(docs)

        splitter = RecursiveCharacterTextSplitter(
            chunk_size=config.CHUNK_SIZE,
            chunk_overlap=config.CHUNK_OVERLAP,
            separators=["\n\n", "\n", ". ", " ", ""],
        )
        chunks = splitter.split_documents(docs)

        if not chunks:
            return {"chunks_created": 0, "pages_processed": pages_processed}

        texts = [c.page_content for c in chunks]
        ids = [f"{filename}_{i}_{uuid.uuid4().hex[:8]}" for i in range(len(chunks))]
        metadatas = [
            {
                "source": filename,
                "page": c.metadata.get("page", 0) + 1,
                "chunk_index": i,
            }
            for i, c in enumerate(chunks)
        ]

        model = _get_embedding_model()
        embeddings = model.encode(texts, show_progress_bar=False).tolist()

        collection = _get_chroma_collection()

        # Remove old chunks for this file (re-upload = re-index)
        try:
            existing = collection.get(where={"source": filename})
            if existing["ids"]:
                collection.delete(ids=existing["ids"])
        except Exception:
            pass

        # Insert in batches (ChromaDB batch limit)
        batch_size = 100
        for i in range(0, len(ids), batch_size):
            end = i + batch_size
            collection.add(
                ids=ids[i:end],
                documents=texts[i:end],
                embeddings=embeddings[i:end],
                metadatas=metadatas[i:end],
            )

        return {"chunks_created": len(chunks), "pages_processed": pages_processed}
    finally:
        os.unlink(tmp_path)


def list_documents() -> list[dict]:
    """List all ingested documents with chunk counts."""
    try:
        collection = _get_chroma_collection()
        all_data = collection.get(include=["metadatas"])
        if not all_data["metadatas"]:
            return []

        counts: dict[str, int] = {}
        for meta in all_data["metadatas"]:
            src = meta.get("source", "unknown")
            counts[src] = counts.get(src, 0) + 1

        return [{"filename": name, "chunks": count} for name, count in counts.items()]
    except Exception:
        return []


def delete_document(filename: str) -> bool:
    """Delete all chunks for a given document."""
    try:
        collection = _get_chroma_collection()
        existing = collection.get(where={"source": filename})
        if existing["ids"]:
            collection.delete(ids=existing["ids"])
            return True
        return False
    except Exception:
        return False
