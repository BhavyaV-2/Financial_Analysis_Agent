from pydantic import BaseModel
from typing import List, Dict, Any


class ChatRequest(BaseModel):
    question: str
    chat_history: List[Dict[str, Any]] = []


class UploadResponse(BaseModel):
    message: str
    file_name: str
    chunks_created: int
    pages_processed: int


class DocumentInfo(BaseModel):
    filename: str
    chunks: int


class SourceChunk(BaseModel):
    content: str
    page: int
    relevance_score: float
    source: str