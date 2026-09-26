# Fintrack — Interview Study Guide

This document covers every question you're likely to face in an AI/ML engineer interview about this project. Answers are kept simple, jargon-free, and structured as direct responses you'd give in conversation.

---

## 1. Project Overview

### "Tell me about this project."

Fintrack is a financial document Q&A bot. You upload a PDF (like an annual report or 10-K filing), and it lets you ask natural language questions about it. Under the hood, it uses RAG — Retrieval-Augmented Generation — to find relevant parts of the document and generate grounded answers.

### "Why did you build it?"

Most financial reports are 100+ pages. Nobody reads them end to end. I wanted a tool where you could upload a report and immediately ask "what was the revenue growth?" or "what risks did they mention?" and get a sourced answer in seconds.

### "What makes this different from just pasting a PDF into ChatGPT?"

Three things:
1. **Structured retrieval** — I don't dump the whole PDF into the context window. I chunk it, embed it, retrieve only the relevant pieces, then rerank them. This is more precise and scales to large documents.
2. **Financial guardrails** — The system refuses to give investment advice, detects prompt injection attempts, and appends a disclaimer to every response.
3. **Source transparency** — Every answer comes with page numbers and snippets showing exactly where the information came from.

---

## 2. RAG Architecture

### "Explain your RAG pipeline step by step."

1. **Ingestion**: PDF → extract text page-by-page → split into 800-character chunks with 200-char overlap → embed each chunk with MiniLM → store in ChromaDB with metadata (filename, page number)

2. **Query processing**: User asks a question → input guardrails check for safety → query is rewritten using chat history to be self-contained

3. **Retrieval**: Rewritten query is embedded → similarity search in ChromaDB returns top 5 candidates

4. **Reranking**: Each candidate chunk is scored by the LLM (0-10) for relevance → top 3 are kept

5. **Generation**: The 3 chunks are formatted as context → combined with the system prompt and user question → streamed from Gemini

6. **Output processing**: Financial disclaimer is appended → source citations are sent → response is delivered via SSE

### "Why not just use a simple similarity search? Why reranking?"

Embedding similarity is a rough filter. It works on the vector space level — "do these texts feel similar?" But it can miss semantic relevance. For example, a chunk about "operating expenses" might be semantically close to a query about "revenue" (both are financial terms), but not actually relevant.

The reranking step uses the LLM to read each chunk and ask "does this actually answer the question?" That's a much more precise signal. The pattern is: cast a wide net (top 5), then filter carefully (top 3).

### "Why did you choose to retrieve 5 and keep 3?"

It's a precision-recall tradeoff. If I only retrieved 3, I might miss a relevant chunk that had a slightly different wording. Retrieving 5 gives me a wider net. Reranking to 3 keeps the context window lean — I don't want to flood the LLM with irrelevant chunks, which dilutes answer quality.

These specific numbers are tunable. The point is having the two-stage pipeline, not the exact values.

---

## 3. Chunking Strategy

### "Why 800 characters with 200 overlap?"

Financial documents are dense. A single paragraph might contain revenue figures, growth percentages, and year-over-year comparisons. With the standard 1000-char chunks, I was getting chunks that mixed unrelated data — part of a revenue table merged with risk factor text.

800 characters is small enough to keep each chunk focused on one topic. The 200-char overlap means if a table row or sentence spans a chunk boundary, it appears in both chunks, so I don't lose information at the seams.

### "Why RecursiveCharacterTextSplitter specifically?"

It splits on natural boundaries first — paragraph breaks (`\n\n`), then line breaks (`\n`), then sentence endings (`. `), then spaces, and finally characters. This means it tries to keep paragraphs and sentences intact rather than cutting mid-word. For financial data, preserving sentence structure matters.

---

## 4. Embedding & Vector Store

### "Why MiniLM instead of a more powerful embedding model?"

Three reasons:
1. **It's free** — runs locally on CPU, no API calls needed
2. **It's fast** — encoding a 50-page PDF takes a few seconds
3. **Embedding quality matters less than retrieval strategy** — the reranking step compensates for any precision gap. A better embedding model might get me from 80% to 85% retrieval accuracy, but reranking gets me from 80% to 95%.

If this were production with millions of documents, I'd consider a better model. For single-document Q&A, MiniLM is sufficient.

### "Why ChromaDB over Supabase/Pinecone/FAISS?"

- **vs Supabase (what v1 used)**: Supabase requires an account, API keys, cloud connectivity. For a local project, that's unnecessary complexity. ChromaDB persists to disk with zero setup.
- **vs Pinecone**: Same cloud dependency problem. Also costs money.
- **vs FAISS**: FAISS is a search library, not a database. It doesn't handle metadata, persistence, or CRUD operations. I'd need to build all of that myself. ChromaDB gives me metadata filtering (search by filename, page) out of the box.

### "How does ChromaDB persist data?"

It uses SQLite under the hood. When you create a `PersistentClient` with a path, it saves the index and metadata to that directory. On restart, it loads from disk automatically. No separate database process needed.

---

## 5. LLM Choice

### "Why Gemini 3.5 Flash Lite?"

- **Fast**: Flash Lite has low latency, which matters for streaming
- **Cheap**: It's one of the cheapest Gemini models per token
- **Sufficient**: For document Q&A (not creative writing or complex reasoning), a lightweight model is fine. The answers are grounded in the document anyway — the model just needs to synthesize, not hallucinate.

### "Why not use LangChain for the LLM call?"

I use LangChain's text splitter because it's genuinely useful — the `RecursiveCharacterTextSplitter` with customizable separators is well-designed.

But for the LLM call, LangChain adds an abstraction layer over the Gemini SDK that provides no benefit when I'm using exactly one model. The `google-genai` SDK already gives me streaming, system instructions, and temperature control. Adding LangChain's `ChatGoogleGenerativeAI` wrapper would just mean more dependencies and more things that can break.

This shows you know when to use a framework and when it's unnecessary overhead.

### "How does the streaming work?"

Server-Sent Events (SSE). The FastAPI backend uses `StreamingResponse` with `text/event-stream` content type. As Gemini generates tokens, each chunk is wrapped in a JSON event (`{"type": "chunk", "content": "..."}`) and pushed to the client.

The frontend uses the Fetch API with `ReadableStream` to consume the stream. It reads chunks, splits on double newlines (SSE format), and parses each event to progressively update the chat message.

### "Why SSE instead of WebSockets?"

Chat is unidirectional during generation — the server sends, the client receives. SSE is designed for exactly this pattern. WebSockets would give me bidirectional communication, but I don't need the client to send messages during streaming. SSE is simpler, uses standard HTTP, and is natively supported by browsers without extra libraries.

---

## 6. Guardrails

### "What guardrails did you implement and why?"

Financial data is sensitive. Even for a portfolio project, showing you thought about safety is a differentiator.

**Input guardrails** (run before retrieval):
- **Length limit**: Reject queries over 2000 chars (prevents abuse)
- **Prompt injection detection**: Regex patterns catch "ignore previous instructions", "you are now a...", etc.
- **Investment advice blocking**: Catches "should I buy", "will the stock go up", etc. Returns a helpful redirect instead of a hard block.

**Output guardrails** (run after generation):
- **Financial disclaimer**: Appended to every response. "This is for informational purposes only."
- **Source citations**: Page numbers and snippet previews so users can verify
- **Low-confidence warning**: If all retrieval scores are below 4/10, a warning is prepended telling the user the answer may not be reliable

### "How do you detect prompt injection?"

Regex pattern matching on the input. I look for phrases like "ignore previous instructions", "system:", "you are now", "forget everything". It's not perfect — a determined attacker could bypass it — but it catches the common patterns.

For a production system, I'd add an LLM-based classifier or use a dedicated guardrails service. For a portfolio project, regex is the right level of effort.

### "Why is the disclaimer always shown, even when the answer is clearly correct?"

Legal principle: in the financial domain, you always disclaim. It's not about whether the answer is correct — it's about making clear that the system is not a financial advisor. Every Bloomberg terminal, every analyst report, every financial tool has a disclaimer. Omitting it would be a red flag in any financial context.

---

## 7. Query Rewriting

### "What is query rewriting and why do you do it?"

When a user asks follow-up questions, they use pronouns. "What was the revenue?" → "How does it compare to last year?" The word "it" refers to revenue, but the retrieval system doesn't know that — it just sees the standalone question.

Query rewriting takes the chat history and the new question, and produces a self-contained version: "How does the revenue compare to last year?" This self-contained question retrieves much better results.

### "How do you implement it?"

I send the chat history + new question to Gemini with a simple prompt: "Rewrite this question to be self-contained, resolving any pronouns." The model returns the rewritten question, which I use for retrieval. The original question is still shown in the UI and sent to the final generation step.

---

## 8. Frontend

### "Walk me through the UI architecture."

Single-page app in Next.js with three states:

1. **Welcome state** (no document): Shows upload dropzone + sample question pills
2. **Ready state** (document loaded, no messages): Shows clickable example prompts in a grid
3. **Chat state** (messages exist): Shows conversation with streaming text, source citations, and copy buttons

The header shows the app name, current document info (name + chunk count) via a dropdown manager, and a theme toggle.

### "How do you handle streaming on the frontend?"

Using the native Fetch API with `ReadableStream`:

```
fetch('/chat/', { method: 'POST', body: ... })
  → response.body.getReader()
  → read chunks in a loop
  → split on '\n\n' (SSE boundary)
  → parse JSON from each 'data:' line
  → update React state progressively
```

I don't use `EventSource` because it only supports GET requests. I need POST to send the question and chat history.

### "How is chat history persisted?"

`localStorage`. On every completed exchange (when streaming finishes), messages are serialized to JSON and saved. On page load, they're restored. The active document info is also persisted.

For production, this would be a database. For a local tool, browser storage is appropriate.

---

## 9. Design Decisions (Rapid-Fire)

### "Why a monorepo?"

Backend and frontend are tightly coupled (shared API contract). A monorepo makes it easy to develop, test, and reason about both together.

### "Why FastAPI?"

Async support, automatic OpenAPI docs, Pydantic validation, and native `StreamingResponse` for SSE. Flask would work but doesn't have built-in async.

### "Why no Docker?"

This is a local development tool, not deployed. Docker adds setup complexity for no gain. If I were deploying, I'd add a `docker-compose.yml` with separate containers for backend and frontend.

### "What would you change for production?"

1. **Replace ChromaDB with pgvector or Pinecone** — for multi-user, multi-document scale
2. **Add authentication** — user accounts, private document management
3. **Use a cross-encoder for reranking** — instead of LLM-based reranking, a dedicated cross-encoder model is faster and cheaper at scale
4. **Add table extraction** — use Camelot or Tabula for structured table parsing, not just text extraction
5. **Add evaluation** — RAGAS or similar framework to measure retrieval quality and answer faithfulness
6. **Add rate limiting** — protect the API from abuse

---

## 10. Potential Follow-Up Questions

### "How would you evaluate the quality of your RAG system?"

Two dimensions:
- **Retrieval quality**: Are the right chunks being retrieved? Measure with precision@k — for a set of test questions, check if the top-3 chunks contain the ground truth.
- **Answer quality**: Is the generated answer faithful to the source? Use RAGAS metrics — faithfulness (is the answer grounded?) and answer relevance (does it address the question?).

### "What happens if the PDF has tables?"

PyPDFLoader extracts tables as plain text, which mostly preserves the structure for simple tables. For complex nested tables, the text extraction can be messy. The fix would be adding Camelot or Tabula for structured table extraction, but that's a v3 enhancement.

### "How do you handle very large PDFs (400+ pages)?"

A 400+ page document produces 1,000+ chunks and takes 30-60 seconds to process. A standard blocking HTTP POST would make users think the app froze or risk gateway timeouts.

I solved this by making the `/upload/` endpoint stream real-time Server-Sent Events (SSE):
1. **Upfront page count**: Using `pypdf.PdfReader` to count total pages in milliseconds.
2. **Page-by-page scan**: Emitting progress updates every 5% of pages read (`Stage 1: Scan & Read`).
3. **Chunking feedback**: Reporting chunk counts and overlap boundaries (`Stage 2: Chunk Text`).
4. **Batched embeddings**: MiniLM encodes chunks in batches of 64 on CPU, emitting live chunk counts and batch numbers (`Stage 3: Generate Vectors`).
5. **ChromaDB insertion**: Inserting in batches of 100 with live vector count indicators (`Stage 4: Save to ChromaDB`).
6. **Frontend UI**: A live percentage progress bar with an interactive stepper keeps the user informed throughout the entire process.

### "What if the user uploads multiple documents?"

Supported. Each chunk has a `source` metadata field with the filename. ChromaDB retrieves across all documents. If you re-upload the same filename, old chunks are deleted first (deduplication).

### "Why not fine-tune a model instead of using RAG?"

Fine-tuning bakes knowledge into the model weights — you'd need to retrain every time a new report is released. RAG keeps the knowledge in the vector store, which can be updated instantly by uploading a new PDF. For a document Q&A use case, RAG is the right pattern. Fine-tuning is for teaching the model a new skill or style, not for adding factual knowledge.

---

## 11. Technical Gotchas I'd Mention

- **Chunk overlap isn't free**: 200-char overlap means ~25% of tokens are duplicated across chunks. That's a storage-accuracy tradeoff.
- **LLM-based reranking adds latency**: 5 reranking calls to Gemini add ~1-2 seconds. A cross-encoder would be faster but adds another model dependency.
- **SSE doesn't handle disconnects gracefully**: If the network drops mid-stream, the frontend doesn't retry. Production would need reconnection logic.
- **The disclaimer is hardcoded, not LLM-generated**: This is intentional — legal text should never be generated by an LLM. It should be deterministic.
