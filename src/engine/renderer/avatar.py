from __future__ import annotations

from pathlib import Path
from typing import Iterator, Optional

from PIL import Image

from engine.timeline.builder import state_iterator


class AvatarRenderer:
    def __init__(self, avatar_dir: Path, width: int, height: int, fps: int) -> None:
        self.avatar_dir = avatar_dir
        self.width = width
        self.height = height
        self.fps = fps

        self._idle = self._load_rgba("idle.png")
        self._talk = self._load_rgba("talk.png")
        self._idle_blink = self._try_load("idle_blink.png")
        self._talk_blink = self._try_load("talk_blink.png")
        self._blink = self._try_load("blink.png")

    def _load_rgba(self, name: str) -> bytes:
        path = self.avatar_dir / name
        if not path.exists():
            raise FileNotFoundError(f"Missing required avatar image: {path}")
        with Image.open(path) as img:
            prepared = self._prepare_rgba(img)
            return prepared.tobytes()

    def _try_load(self, name: str) -> Optional[bytes]:
        path = self.avatar_dir / name
        if not path.exists():
            return None
        with Image.open(path) as img:
            prepared = self._prepare_rgba(img)
            return prepared.tobytes()

    def _prepare_rgba(self, img: Image.Image) -> Image.Image:
        rgba = img.convert("RGBA").resize((self.width, self.height), Image.Resampling.LANCZOS)
        # Reduce colored fringe on alpha edges by neutralizing fully transparent RGB values.
        pixels = list(rgba.getdata())
        cleaned = [(0, 0, 0, 0) if a == 0 else (r, g, b, a) for (r, g, b, a) in pixels]
        rgba.putdata(cleaned)
        return rgba

    def frame_bytes(self, total_frames: int, timeline: list[dict[str, str | int]]) -> Iterator[bytes]:
        states = state_iterator(total_frames, timeline)
        for frame, state in enumerate(states):
            blinking = self._blink_frame(frame)
            if state == "talk":
                if blinking and self._talk_blink is not None:
                    yield self._talk_blink
                elif blinking and self._blink is not None:
                    yield self._blink
                else:
                    yield self._talk
            else:
                if blinking and self._idle_blink is not None:
                    yield self._idle_blink
                elif blinking and self._blink is not None:
                    yield self._blink
                else:
                    yield self._idle

    def _blink_frame(self, frame: int) -> bool:
        cycle = self.fps * 4
        phase = frame % cycle
        return phase in {0, 1, 2}

