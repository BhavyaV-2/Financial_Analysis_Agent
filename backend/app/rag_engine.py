import json
from typing import AsyncGenerator

from google.genai import types

from . import config
from .prompts import SYSTEM_PROMPT, RAG_PROMPT_TEMPLATE, QUERY_REWRITE_PROMPT
from .guardrails import validate_input, format_output, build_source_citations, FINANCIAL_DISCLAIMER
from .retriever import retrieve, _get_gemini_client


def _format_chat_history(chat_history: list[dict]) -> str:
    if not chat_history:
        return "No previous conversation."
    formatted = []
    for msg in chat_history[-6:]:  # last 3 turns
        role = "User" if msg.get("type") == "human" else "Assistant"
        content = msg.get("content", "")
        if len(content) > 300:
            content = content[:300] + "..."
        formatted.append(f"{role}: {content}")
    return "\n".join(formatted)


def _rewrite_query(question: str, chat_history: list[dict]) -> str:
    """Rewrite the query to be self-contained using chat history."""
    if not chat_history:
        return question

    prompt = QUERY_REWRITE_PROMPT.format(
        chat_history=_format_chat_history(chat_history),
        question=question,
    )
    try:
        client = _get_gemini_client()
        response = client.models.generate_content(
            model=config.GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(temperature=0.0, max_output_tokens=200),
        )
        rewritten = response.text.strip()
        return rewritten if rewritten else question
    except Exception:
        return question


async def process_query(
    question: str, chat_history: list[dict]
) -> AsyncGenerator[str, None]:
    """
    Full RAG pipeline with SSE streaming.

    Event types:
      {"type": "chunk",   "content": "partial text"}
      {"type": "sources", "content": [{page, snippet, score, source}]}
      {"type": "done"}
      {"type": "error",   "content": "message"}
    """
    # 1. Input guardrails
    is_safe, reason = validate_input(question)
    if not is_safe:
        yield f"data: {json.dumps({'type': 'error', 'content': reason})}\n\n"
        return

    try:
        # 2. Query rewriting (resolve pronouns from chat history)
        rewritten = _rewrite_query(question, chat_history)

        # 3. Retrieve relevant chunks
        sources = retrieve(rewritten)

        if not sources:
            yield f"data: {json.dumps({'type': 'chunk', 'content': 'No relevant information was found in the uploaded document for this question. Please try rephrasing or upload a different document.'})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
            return

        # 4. Check confidence
        avg_score = sum(s["score"] for s in sources) / len(sources)
        low_confidence = avg_score < 4.0

        if low_confidence:
            warning = (
                "> ⚠️ **Low confidence:** The retrieved context may not be closely "
                "related to your question. Please verify against the original document.\n\n"
            )
            yield f"data: {json.dumps({'type': 'chunk', 'content': warning})}\n\n"

        # 5. Build prompt
        context_parts = []
        for i, src in enumerate(sources):
            context_parts.append(f"[Excerpt {i+1}, Page {src['page']}]\n{src['content']}")
        context = "\n\n---\n\n".join(context_parts)

        user_prompt = RAG_PROMPT_TEMPLATE.format(
            context=context,
            chat_history=_format_chat_history(chat_history),
            question=question,
        )

        # 6. Stream from Gemini
        client = _get_gemini_client()
        for chunk in client.models.generate_content_stream(
            model=config.GEMINI_MODEL,
            contents=user_prompt,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                temperature=0.3,
                max_output_tokens=1024,
            ),
        ):
            if chunk.text:
                yield f"data: {json.dumps({'type': 'chunk', 'content': chunk.text})}\n\n"

        # 7. Append disclaimer
        yield f"data: {json.dumps({'type': 'chunk', 'content': FINANCIAL_DISCLAIMER})}\n\n"

        # 8. Send source citations
        citations = build_source_citations(sources)
        yield f"data: {json.dumps({'type': 'sources', 'content': citations})}\n\n"

        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    except Exception as e:
        yield f"data: {json.dumps({'type': 'error', 'content': f'An error occurred: {str(e)}'})}\n\n"
