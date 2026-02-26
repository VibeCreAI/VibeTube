from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass(slots=True)
class RenderResult:
    out_dir: Path
    audio_path: Path
    duration_sec: float
    captions_path: Optional[Path]
    meta_path: Path
    timeline_path: Path
    video_path: Optional[Path] = None
    png_dir: Optional[Path] = None

