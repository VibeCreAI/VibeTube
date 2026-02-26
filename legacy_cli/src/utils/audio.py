from __future__ import annotations

import contextlib
import wave
from pathlib import Path


class AudioError(RuntimeError):
    """Raised when an audio file cannot be parsed."""


def wav_duration_seconds(wav_path: Path) -> float:
    try:
        with contextlib.closing(wave.open(str(wav_path), "rb")) as stream:
            frames = stream.getnframes()
            rate = stream.getframerate()
            if rate <= 0:
                raise AudioError(f"Invalid sample rate in {wav_path}")
            return frames / float(rate)
    except wave.Error as exc:
        raise AudioError(f"Unsupported WAV format for {wav_path}: {exc}") from exc

