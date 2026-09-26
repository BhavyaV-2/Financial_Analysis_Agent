# Fintrack — Financial Document RAG Bot

A local-first RAG (Retrieval-Augmented Generation) application for analyzing financial documents. Upload a PDF, and Fintrack will chunk it, embed it, and let you ask questions — with streaming answers, source citations, and financial guardrails.

## Architecture

```
PDF Upload → PyPDFLoader → Chunk (800/200) → MiniLM Embeddings → ChromaDB
                                                                      ↓
User Question → Input Guardrails → Query Rewrite → Retrieve (k=5) → Rerank (LLM, top 3)
                                                                      ↓
                                            Gemini 3.5 Flash Lite → SSE Stream → UI
                                                                      ↓
                                                      Output Guardrails + Disclaimer + Sources
```

## Stack

| Layer | Technology | Why |
|:---|:---|:---|
| **LLM** | Gemini 3.5 Flash Lite | Fast, cheap, streaming support |
| **Embeddings** | all-MiniLM-L6-v2 (local) | Free, runs on CPU, no API calls |
| **Vector DB** | ChromaDB (local) | Zero setup, persistent, metadata filtering |
| **Backend** | FastAPI | SSE streaming, async, lightweight |
| **Frontend** | Next.js 16 + Tailwind + shadcn/ui | Modern React with dark mode |

## Project Structure

```
├── backend/
│   ├── app/
│   │   ├── config.py          # All configuration (model, chunking, safety)
│   │   ├── main.py            # FastAPI endpoints (upload, chat, documents)
│   │   ├── ingestion.py       # PDF → chunks → ChromaDB
│   │   ├── retriever.py       # Similarity search + LLM reranking
│   │   ├── rag_engine.py      # Orchestrator (guardrails → retrieve → stream)
│   │   ├── prompts.py         # System, rewrite, rerank prompt templates
│   │   ├── guardrails.py      # Input validation + output safety
│   │   └── schemas.py         # Pydantic request/response models
│   ├── requirements.txt
│   └── chroma_data/           # Local vector store (auto-created, gitignored)
│
├── frontend/
│   ├── app/
│   │   ├── page.tsx           # Main chat interface
│   │   ├── layout.tsx         # Root layout with theme provider
│   │   └── globals.css        # Tailwind + financial color palette
│   └── components/
│       ├── chat-message.tsx       # Streaming message with sources
│       ├── upload-dropzone.tsx    # Drag-and-drop PDF upload
│       ├── source-citation.tsx    # Collapsible source references
│       ├── document-manager.tsx   # Document list in header
│       ├── welcome-screen.tsx     # Upload prompt on first visit
│       └── theme-toggle.tsx       # Dark/light mode
│
└── .env                       # GEMINI_API_KEY=your_key_here
```

## Setup

### Prerequisites
- Python 3.10+
- Node.js 18+
- A [Gemini API key](https://aistudio.google.com/apikey)

### Backend

```bash
cd backend

# Create and activate virtual environment
python -m venv venv
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Create .env file in project root
echo "GEMINI_API_KEY=your_key_here" > ../.env

# Run the server
uvicorn app.main:app --reload
```

The backend runs on `http://127.0.0.1:8000`. API docs at `/docs`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend runs on `http://localhost:3000`.

## API Endpoints

| Method | Endpoint | Description |
|:---|:---|:---|
| `POST` | `/upload/` | Upload a PDF → real-time SSE progress stream (scan, chunk, batch embed, index) for 400+ page reports |
| `POST` | `/chat/` | Send a question → SSE streaming response |
| `GET` | `/documents/` | List all indexed documents |
| `DELETE` | `/documents/{filename}` | Remove a document and its embeddings |

## RAG Pipeline

1. **Input Guardrails** — Block prompt injections, investment advice requests, and overly long queries
2. **Query Rewrite** — Use chat history to make the question self-contained (resolves "it", "that company", etc.)
3. **Retrieve** — Embed query with MiniLM → ChromaDB similarity search (top 5)
4. **Rerank** — Gemini scores each chunk's relevance (0-10) → keep top 3
5. **Generate** — Stream response from Gemini with system prompt enforcing document grounding
6. **Output Guardrails** — Append source citations, financial disclaimer, and low-confidence warnings

## Key Design Decisions

- **Local embeddings, cloud LLM**: Embeddings are cheap/fast to run locally. LLM quality matters more, so we use Gemini's API.
- **LangChain for splitting only**: LangChain's `RecursiveCharacterTextSplitter` is useful. Its LLM wrappers add unnecessary abstraction when calling one API directly.
- **800/200 chunk size**: Financial documents are information-dense. Smaller chunks = more precise retrieval. Higher overlap = don't split mid-table.
- **Retrieve 5, rerank to 3**: Over-retrieve then filter catches matches that pure embedding similarity misses.
- **SSE over WebSockets**: Chat is server→client only. SSE is the right primitive for unidirectional streaming.
