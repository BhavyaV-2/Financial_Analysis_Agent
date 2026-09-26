from google import genai
from google.genai import types

from . import config
from .ingestion import _get_chroma_collection, _get_embedding_model
from .prompts import RERANK_PROMPT

_gemini_client = None


def _get_gemini_client() -> genai.Client:
    global _gemini_client
    if _gemini_client is None:
        _gemini_client = genai.Client(api_key=config.GEMINI_API_KEY)
    return _gemini_client


def retrieve(query: str) -> list[dict]:
    """
    Retrieve-then-rerank pipeline:
    1. Embed query → ChromaDB similarity search (top_k=5)
    2. LLM reranks each candidate (Gemini scores 0-10)
    3. Return top_n sorted by relevance
    """
    model = _get_embedding_model()
    query_embedding = model.encode([query], show_progress_bar=False).tolist()[0]

    collection = _get_chroma_collection()
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=config.RETRIEVAL_TOP_K,
        include=["documents", "metadatas", "distances"],
    )

    if not results["documents"] or not results["documents"][0]:
        return []

    candidates = []
    for i in range(len(results["documents"][0])):
        candidates.append({
            "content": results["documents"][0][i],
            "page": results["metadatas"][0][i].get("page", 0),
            "source": results["metadatas"][0][i].get("source", ""),
            "distance": results["distances"][0][i],
        })

    # Rerank with Gemini
    client = _get_gemini_client()
    scored = []

    for candidate in candidates:
        try:
            prompt = RERANK_PROMPT.format(
                question=query,
                chunk=candidate["content"][:500],
            )
            response = client.models.generate_content(
                model=config.GEMINI_MODEL,
                contents=prompt,
                config=types.GenerateContentConfig(temperature=0.0, max_output_tokens=5),
            )
            score = float(response.text.strip())
            score = max(0.0, min(10.0, score))
        except Exception:
            # Fallback: convert cosine distance to a rough 0-10 score
            score = max(0.0, 10.0 - candidate["distance"] * 10.0)

        scored.append({**candidate, "score": score})

    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[: config.RERANK_TOP_N]
