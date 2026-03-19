"""Shared upload helpers for chunked file streaming with size limits."""

from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import HTTPException, UploadFile

UPLOAD_CHUNK_SIZE = 1024 * 1024
MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024


async def write_upload_to_temp(
    file: UploadFile,
    *,
    suffix: str,
    max_size_bytes: int = MAX_UPLOAD_SIZE_BYTES,
    chunk_size: int = UPLOAD_CHUNK_SIZE,
) -> Path:
    """Stream an uploaded file to disk with a hard size cap."""
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        total_size = 0
        while chunk := await file.read(chunk_size):
            total_size += len(chunk)
            if total_size > max_size_bytes:
                Path(tmp.name).unlink(missing_ok=True)
                raise HTTPException(
                    status_code=413,
                    detail=f"File too large (max {max_size_bytes // (1024 * 1024)} MB)",
                )
            tmp.write(chunk)
        return Path(tmp.name)

