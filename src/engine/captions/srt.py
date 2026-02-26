from __future__ import annotations

import math
import re
from pathlib import Path


def write_srt(text: str, duration_sec: float, out_path: Path) -> Path:
    chunks = _sentence_chunks(text)
    if not chunks:
        chunks = [text.strip() or "..."]

    total_weight = sum(max(1, len(chunk)) for chunk in chunks)
    cursor = 0.0

    lines: list[str] = []
    for i, chunk in enumerate(chunks, start=1):
        weight = max(1, len(chunk))
        seg_duration = duration_sec * (weight / total_weight)
        start = cursor
        end = duration_sec if i == len(chunks) else min(duration_sec, cursor + seg_duration)

        lines.append(str(i))
        lines.append(f"{_fmt_srt_ts(start)} --> {_fmt_srt_ts(end)}")
        lines.append(chunk)
        lines.append("")
        cursor = end

    out_path.write_text("\n".join(lines), encoding="utf-8")
    return out_path


def _sentence_chunks(text: str) -> list[str]:
    cleaned = re.sub(r"\s+", " ", text.strip())
    if not cleaned:
        return []
    parts = re.split(r"(?<=[.!?])\s+", cleaned)
    return [part.strip() for part in parts if part.strip()]


def _fmt_srt_ts(seconds: float) -> str:
    total_ms = int(math.floor(seconds * 1000))
    ms = total_ms % 1000
    total_seconds = total_ms // 1000
    sec = total_seconds % 60
    total_minutes = total_seconds // 60
    minute = total_minutes % 60
    hour = total_minutes // 60
    return f"{hour:02d}:{minute:02d}:{sec:02d},{ms:03d}"

