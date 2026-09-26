import re
from . import config


FINANCIAL_DISCLAIMER = (
    "\n\n---\n*⚠️ Disclaimer: This analysis is based solely on the uploaded document "
    "and is for informational purposes only. It does not constitute financial advice. "
    "Always consult a qualified financial professional before making investment decisions.*"
)

INJECTION_PATTERNS = [
    r"ignore\s+(all\s+)?(previous|above|prior)\s+(instructions|prompts|rules)",
    r"you\s+are\s+now",
    r"new\s+instruction",
    r"system\s*:",
    r"<\s*system\s*>",
    r"forget\s+(everything|all|your\s+instructions)",
    r"disregard\s+(all|previous|your)",
    r"override\s+(your|the|all)",
]

ADVICE_PATTERNS = [
    r"should\s+i\s+(buy|sell|invest|trade|short|hold)",
    r"will\s+.+\s+(stock|share|price)\s+(go\s+up|go\s+down|rise|fall|increase|decrease|crash)",
    r"predict\s+.*(stock|market|price|share)",
    r"is\s+.+\s+a\s+good\s+(investment|buy|stock\s+to\s+buy)",
    r"(buy|sell)\s+recommendation",
    r"what\s+stock.*(should|recommend)",
    r"(give|provide)\s+.*(investment|financial)\s+advice",
]


def validate_input(question: str) -> tuple[bool, str | None]:
    """Validate user input before RAG processing."""
    if len(question.strip()) == 0:
        return False, "Please enter a question."

    if len(question) > config.MAX_INPUT_LENGTH:
        return False, f"Question too long. Please keep it under {config.MAX_INPUT_LENGTH} characters."

    question_lower = question.lower()

    for pattern in INJECTION_PATTERNS:
        if re.search(pattern, question_lower):
            return False, "Your question could not be processed. Please rephrase it."

    for pattern in ADVICE_PATTERNS:
        if re.search(pattern, question_lower):
            return False, (
                "I can't provide personal investment advice or market predictions. "
                "I can help you analyze the data in your uploaded document — try asking "
                "about specific metrics, trends, or comparisons mentioned in the report."
            )

    return True, None


def format_output(response: str, sources: list[dict], low_confidence: bool = False) -> str:
    """Apply output guardrails: confidence warning + disclaimer."""
    parts = []

    if low_confidence:
        parts.append(
            "> ⚠️ **Low confidence:** The retrieved context may not be closely related "
            "to your question. The answer below should be verified against the original document.\n"
        )

    parts.append(response)
    parts.append(FINANCIAL_DISCLAIMER)

    return "\n".join(parts)


def build_source_citations(sources: list[dict]) -> list[dict]:
    """Build structured source citations for the frontend."""
    citations = []
    seen_pages = set()
    for source in sources:
        page = source.get("page", 0)
        if page not in seen_pages:
            seen_pages.add(page)
            citations.append({
                "page": page,
                "snippet": source.get("content", "")[:150] + "...",
                "score": round(source.get("score", 0), 1),
                "source": source.get("source", ""),
            })
    return citations
