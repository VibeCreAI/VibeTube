"""Error handling helpers shared across backend routes."""

from __future__ import annotations

import json
from typing import Any


def extract_error_message(detail: Any) -> str:
    """Extract a readable message from FastAPI-style error payloads."""
    if isinstance(detail, dict):
        message = detail.get("message")
        if isinstance(message, str) and message.strip():
            return message
        if "detail" in detail:
            return extract_error_message(detail["detail"])
        return json.dumps(detail, ensure_ascii=False)
    if isinstance(detail, list):
        parts = [extract_error_message(item) for item in detail]
        return "; ".join(part for part in parts if part)
    if detail is None:
        return ""
    return str(detail)

