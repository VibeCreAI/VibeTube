from __future__ import annotations

from pathlib import Path
from typing import Iterable

from PIL import Image


def export_png_sequence(
    frame_iter: Iterable[bytes],
    out_dir: Path,
    width: int,
    height: int,
    fps: int,
    total_frames: int,
    logger,
) -> Path:
    frames_dir = out_dir / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    for idx, frame_bytes in enumerate(frame_iter):
        img = Image.frombytes("RGBA", (width, height), frame_bytes)
        img.save(frames_dir / f"frame_{idx:08d}.png")
        if (idx + 1) % max(1, fps * 5) == 0:
            logger.info("PNG progress: %d/%d frames", idx + 1, total_frames)

    return frames_dir

