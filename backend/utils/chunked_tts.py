"""
Chunked TTS generation utilities.
"""

import logging
import re
from typing import List, Tuple

import numpy as np

logger = logging.getLogger("vibetube.chunked-tts")

DEFAULT_MAX_CHUNK_CHARS = 800
_ABBREVIATIONS = frozenset(
    {
        "mr",
        "mrs",
        "ms",
        "dr",
        "prof",
        "sr",
        "jr",
        "st",
        "ave",
        "blvd",
        "inc",
        "ltd",
        "corp",
        "dept",
        "est",
        "approx",
        "vs",
        "etc",
        "e.g",
        "i.e",
        "a.m",
        "p.m",
        "u.s",
        "u.s.a",
        "u.k",
    }
)
_PARA_TAG_RE = re.compile(r"\[[^\]]*\]")


def split_text_into_chunks(text: str, max_chars: int = DEFAULT_MAX_CHUNK_CHARS) -> List[str]:
    text = text.strip()
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]

    chunks: List[str] = []
    remaining = text
    while remaining:
        remaining = remaining.lstrip()
        if not remaining:
            break
        if len(remaining) <= max_chars:
            chunks.append(remaining)
            break

        segment = remaining[:max_chars]
        split_pos = _find_last_sentence_end(segment)
        if split_pos == -1:
            split_pos = _find_last_clause_boundary(segment)
        if split_pos == -1:
            split_pos = segment.rfind(" ")
        if split_pos == -1:
            split_pos = _safe_hard_cut(segment, max_chars)

        chunk = remaining[: split_pos + 1].strip()
        if chunk:
            chunks.append(chunk)
        remaining = remaining[split_pos + 1 :]

    return chunks


def _find_last_sentence_end(text: str) -> int:
    best = -1
    for match in re.finditer(r"[.!?](?:\s|$)", text):
        pos = match.start()
        char = text[pos]
        if char == ".":
            word_start = pos - 1
            while word_start >= 0 and text[word_start].isalpha():
                word_start -= 1
            word = text[word_start + 1 : pos].lower()
            if word in _ABBREVIATIONS:
                continue
            if word_start >= 0 and text[word_start].isdigit():
                continue
        if _inside_bracket_tag(text, pos):
            continue
        best = pos

    for match in re.finditer(r"[\u3002\uff01\uff1f]", text):
        if match.start() > best:
            best = match.start()
    return best


def _find_last_clause_boundary(text: str) -> int:
    best = -1
    for match in re.finditer(r"[;:,\u2014](?:\s|$)", text):
        pos = match.start()
        if _inside_bracket_tag(text, pos):
            continue
        best = pos
    return best


def _inside_bracket_tag(text: str, pos: int) -> bool:
    return any(match.start() < pos < match.end() for match in _PARA_TAG_RE.finditer(text))


def _safe_hard_cut(segment: str, max_chars: int) -> int:
    cut = max_chars - 1
    for match in _PARA_TAG_RE.finditer(segment):
        if match.start() < cut < match.end():
            return match.start() - 1 if match.start() > 0 else cut
    return cut


def concatenate_audio_chunks(
    chunks: List[np.ndarray],
    sample_rate: int,
    crossfade_ms: int = 50,
) -> np.ndarray:
    if not chunks:
        return np.array([], dtype=np.float32)
    if len(chunks) == 1:
        return chunks[0]

    crossfade_samples = int(sample_rate * crossfade_ms / 1000)
    result = np.array(chunks[0], dtype=np.float32, copy=True)

    for chunk in chunks[1:]:
        if len(chunk) == 0:
            continue
        overlap = min(crossfade_samples, len(result), len(chunk))
        if overlap > 0:
            fade_out = np.linspace(1.0, 0.0, overlap, dtype=np.float32)
            fade_in = np.linspace(0.0, 1.0, overlap, dtype=np.float32)
            result[-overlap:] = result[-overlap:] * fade_out + chunk[:overlap] * fade_in
            result = np.concatenate([result, chunk[overlap:]])
        else:
            result = np.concatenate([result, chunk])

    return result


async def generate_chunked(
    backend,
    text: str,
    voice_prompt: dict,
    language: str = "en",
    seed: int | None = None,
    instruct: str | None = None,
    max_chunk_chars: int = DEFAULT_MAX_CHUNK_CHARS,
    crossfade_ms: int = 50,
    trim_fn=None,
) -> Tuple[np.ndarray, int]:
    chunks = split_text_into_chunks(text, max_chunk_chars)
    if len(chunks) <= 1:
        audio, sample_rate = await backend.generate(text, voice_prompt, language, seed, instruct)
        if trim_fn is not None:
            audio = trim_fn(audio, sample_rate)
        return audio, sample_rate

    logger.info(
        "Splitting %d chars into %d chunks (max %d chars each)",
        len(text),
        len(chunks),
        max_chunk_chars,
    )
    audio_chunks: List[np.ndarray] = []
    sample_rate: int | None = None

    for index, chunk_text in enumerate(chunks):
        logger.info("Generating chunk %d/%d (%d chars)", index + 1, len(chunks), len(chunk_text))
        chunk_seed = (seed + index) if seed is not None else None
        chunk_audio, chunk_sr = await backend.generate(
            chunk_text,
            voice_prompt,
            language,
            chunk_seed,
            instruct,
        )
        if trim_fn is not None:
            chunk_audio = trim_fn(chunk_audio, chunk_sr)
        audio_chunks.append(np.asarray(chunk_audio, dtype=np.float32))
        if sample_rate is None:
            sample_rate = chunk_sr

    return concatenate_audio_chunks(audio_chunks, sample_rate, crossfade_ms=crossfade_ms), sample_rate
