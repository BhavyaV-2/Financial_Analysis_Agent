import asyncio
import json
import os
import uuid
from tempfile import NamedTemporaryFile
from typing import AsyncGenerator

import chromadb
from pypdf import PdfReader
from langchain_core.documents import Document
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


async def ingest_pdf_stream(
    file_bytes: bytes, filename: str
) -> AsyncGenerator[str, None]:
    """
    Parse PDF, chunk, embed, and store in ChromaDB with real-time SSE progress events.
    Yields events with { stage, percent, message, detail, data }.
    """
    def _sse(payload: dict) -> str:
        return f"data: {json.dumps(payload)}\n\n"

    with NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    try:
        # Step 1: Open PDF and count pages
        yield _sse({
            "stage": "parsing",
            "percent": 5,
            "message": "Opening PDF and scanning pages...",
            "detail": f"File size: {round(len(file_bytes) / (1024 * 1024), 2)} MB",
        })
        await asyncio.sleep(0)

        reader = PdfReader(tmp_path)
        total_pages = len(reader.pages)

        if total_pages == 0:
            yield _sse({
                "stage": "error",
                "percent": 0,
                "message": "The uploaded PDF appears to be empty or unreadable.",
            })
            return

        yield _sse({
            "stage": "parsing",
            "percent": 8,
            "message": f"Found {total_pages} pages. Extracting text...",
            "detail": f"0 of {total_pages} pages read",
        })
        await asyncio.sleep(0)

        # Step 2: Extract text page by page with progress
        docs: list[Document] = []
        update_interval = max(1, total_pages // 20)  # update roughly every 5%

        for i, page in enumerate(reader.pages):
            text = page.extract_text() or ""
            if text.strip():
                docs.append(Document(page_content=text, metadata={"page": i}))

            if (i + 1) % update_interval == 0 or (i + 1) == total_pages:
                # Parsing spans 8% to 30%
                pct = 8 + int(((i + 1) / total_pages) * 22)
                yield _sse({
                    "stage": "parsing",
                    "percent": pct,
                    "message": f"Reading pages ({i + 1}/{total_pages})...",
                    "detail": f"Extracted {len(docs)} readable pages",
                })
                await asyncio.sleep(0)

        pages_processed = total_pages

        if not docs:
            yield _sse({
                "stage": "error",
                "percent": 0,
                "message": "No extractable text found in this PDF (it may contain only scanned images).",
            })
            return

        # Step 3: Chunking
        yield _sse({
            "stage": "chunking",
            "percent": 32,
            "message": "Chunking text into financial segments...",
            "detail": f"Applying {config.CHUNK_SIZE}-char window with {config.CHUNK_OVERLAP}-char overlap",
        })
        await asyncio.sleep(0)

        splitter = RecursiveCharacterTextSplitter(
            chunk_size=config.CHUNK_SIZE,
            chunk_overlap=config.CHUNK_OVERLAP,
            separators=["\n\n", "\n", ". ", " ", ""],
        )
        chunks = splitter.split_documents(docs)

        if not chunks:
            yield _sse({
                "stage": "error",
                "percent": 0,
                "message": "Failed to create chunks from document text.",
            })
            return

        total_chunks = len(chunks)
        yield _sse({
            "stage": "chunking",
            "percent": 38,
            "message": f"Created {total_chunks} chunks across {pages_processed} pages.",
            "detail": "Ready for vector embedding",
        })
        await asyncio.sleep(0)

        texts = [c.page_content for c in chunks]
        ids = [f"{filename}_{i}_{uuid.uuid4().hex[:8]}" for i in range(total_chunks)]
        metadatas = [
            {
                "source": filename,
                "page": c.metadata.get("page", 0) + 1,
                "chunk_index": i,
            }
            for i, c in enumerate(chunks)
        ]

        # Step 4: Embedding in batches
        yield _sse({
            "stage": "embedding",
            "percent": 40,
            "message": "Loading embedding model (all-MiniLM-L6-v2)...",
            "detail": f"0 of {total_chunks} chunks embedded",
        })
        await asyncio.sleep(0)

        model = _get_embedding_model()
        batch_size = 64
        embeddings: list[list[float]] = []
        num_batches = (total_chunks + batch_size - 1) // batch_size

        for b in range(num_batches):
            start = b * batch_size
            end = min(start + batch_size, total_chunks)
            batch_texts = texts[start:end]

            # Encode batch
            batch_embeddings = model.encode(batch_texts, show_progress_bar=False).tolist()
            embeddings.extend(batch_embeddings)

            # Embedding spans 40% to 85%
            pct = 40 + int((end / total_chunks) * 45)
            yield _sse({
                "stage": "embedding",
                "percent": pct,
                "message": f"Generating vector embeddings: {end} / {total_chunks} chunks...",
                "detail": f"Batch {b + 1} of {num_batches}",
            })
            await asyncio.sleep(0)

        # Step 5: Indexing in ChromaDB
        yield _sse({
            "stage": "indexing",
            "percent": 88,
            "message": "Storing vectors in local ChromaDB...",
            "detail": "Cleaning any previous index for this file...",
        })
        await asyncio.sleep(0)

        collection = _get_chroma_collection()

        # Deduplicate old entries for this file
        try:
            existing = collection.get(where={"source": filename})
            if existing["ids"]:
                collection.delete(ids=existing["ids"])
        except Exception:
            pass

        # Insert into ChromaDB in batches
        chroma_batch_size = 100
        total_to_insert = len(ids)
        num_chroma_batches = (total_to_insert + chroma_batch_size - 1) // chroma_batch_size

        for cb in range(num_chroma_batches):
            c_start = cb * chroma_batch_size
            c_end = min(c_start + chroma_batch_size, total_to_insert)

            collection.add(
                ids=ids[c_start:c_end],
                documents=texts[c_start:c_end],
                embeddings=embeddings[c_start:c_end],
                metadatas=metadatas[c_start:c_end],
            )

            # Indexing spans 88% to 98%
            pct = 88 + int((c_end / total_to_insert) * 10)
            yield _sse({
                "stage": "indexing",
                "percent": pct,
                "message": f"Saving to ChromaDB ({c_end}/{total_to_insert} vectors)...",
                "detail": f"Batch {cb + 1} of {num_chroma_batches}",
            })
            await asyncio.sleep(0)

        # Step 6: Complete
        yield _sse({
            "stage": "complete",
            "percent": 100,
            "message": "Processing complete! Document is ready for analysis.",
            "detail": f"{total_chunks} chunks indexed from {pages_processed} pages",
            "data": {
                "file_name": filename,
                "chunks_created": total_chunks,
                "pages_processed": pages_processed,
            },
        })

    except Exception as e:
        yield _sse({
            "stage": "error",
            "percent": 0,
            "message": f"Ingestion failed: {str(e)}",
        })
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


def ingest_pdf(file_bytes: bytes, filename: str) -> dict:
    """Synchronous ingestion helper for testing."""
    with NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    try:
        reader = PdfReader(tmp_path)
        docs = []
        for i, page in enumerate(reader.pages):
            text = page.extract_text() or ""
            if text.strip():
                docs.append(Document(page_content=text, metadata={"page": i}))

        pages_processed = len(reader.pages)

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

        try:
            existing = collection.get(where={"source": filename})
            if existing["ids"]:
                collection.delete(ids=existing["ids"])
        except Exception:
            pass

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
        if os.path.exists(tmp_path):
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
