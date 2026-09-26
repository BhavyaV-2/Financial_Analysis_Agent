from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from . import schemas
from .ingestion import ingest_pdf_stream, list_documents, delete_document
from .rag_engine import process_query

app = FastAPI(
    title="Fintrack API",
    description="Financial document RAG API with guardrails and streaming.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/upload/")
async def upload_pdf(file: UploadFile = File(...)):
    """Upload and process a PDF for RAG with real-time SSE progress streaming."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    try:
        file_bytes = await file.read()
        return StreamingResponse(
            ingest_pdf_stream(file_bytes, file.filename),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to process document: {str(e)}"
        )


@app.post("/chat/")
async def chat(request: schemas.ChatRequest):
    """Stream a RAG response via Server-Sent Events."""
    return StreamingResponse(
        process_query(request.question, request.chat_history),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@app.get("/documents/", response_model=list[schemas.DocumentInfo])
async def get_documents():
    """List all ingested documents."""
    return list_documents()


@app.delete("/documents/{filename}")
async def remove_document(filename: str):
    """Delete a document and all its embeddings."""
    success = delete_document(filename)
    if not success:
        raise HTTPException(status_code=404, detail="Document not found.")
    return {"message": f"Document '{filename}' deleted successfully."}
