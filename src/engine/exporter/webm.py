from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Iterable


class ExportError(RuntimeError):
    """Raised when ffmpeg export fails."""


def ensure_ffmpeg() -> str:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise ExportError("ffmpeg not found on PATH. Install ffmpeg to export video.")
    return ffmpeg


def export_webm_alpha(
    frame_iter: Iterable[bytes],
    audio_path: Path,
    out_path: Path,
    width: int,
    height: int,
    fps: int,
    total_frames: int,
    logger,
) -> Path:
    ffmpeg = ensure_ffmpeg()

    cmd = [
        ffmpeg,
        "-y",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgba",
        "-s",
        f"{width}x{height}",
        "-r",
        str(fps),
        "-i",
        "-",
        "-i",
        str(audio_path),
        "-c:v",
        "libvpx-vp9",
        "-pix_fmt",
        "yuva420p",
        "-auto-alt-ref",
        "0",
        "-c:a",
        "libopus",
        "-shortest",
        str(out_path),
    ]

    process = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert process.stdin is not None

    try:
        for idx, frame_bytes in enumerate(frame_iter, start=1):
            process.stdin.write(frame_bytes)
            if idx % max(1, fps * 5) == 0:
                logger.info("Export progress: %d/%d frames", idx, total_frames)
    except BrokenPipeError as exc:
        raise ExportError("ffmpeg pipe closed unexpectedly during export.") from exc
    finally:
        process.stdin.close()

    stdout, stderr = process.communicate()
    if process.returncode != 0:
        err_text = stderr.decode("utf-8", errors="ignore")
        out_text = stdout.decode("utf-8", errors="ignore")
        raise ExportError(f"ffmpeg failed with code {process.returncode}: {err_text or out_text}")

    return out_path

