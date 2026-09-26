import os
from dotenv import load_dotenv

load_dotenv()

# --- LLM ---
GEMINI_API_KEY: str = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL: str = "gemini-3.5-flash-lite"

# --- Embeddings (local, no API cost) ---
EMBEDDING_MODEL_NAME: str = "all-MiniLM-L6-v2"

# --- ChromaDB (local persistent store) ---
CHROMA_PERSIST_DIR: str = os.path.join(os.path.dirname(__file__), "..", "chroma_data")
CHROMA_COLLECTION_NAME: str = "financial_documents"

# --- RAG tuning ---
CHUNK_SIZE: int = 800
CHUNK_OVERLAP: int = 200
RETRIEVAL_TOP_K: int = 5
RERANK_TOP_N: int = 3

# --- Safety ---
MAX_INPUT_LENGTH: int = 2000