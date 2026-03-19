"""
Audio processing utilities.
"""

from pathlib import Path
from typing import Optional, Tuple

import librosa
import numpy as np
import soundfile as sf


def normalize_audio(
    audio: np.ndarray,
    target_db: float = -20.0,
    peak_limit: float = 0.85,
) -> np.ndarray:
    """Normalize audio to target loudness with peak limiting."""
    audio = audio.astype(np.float32)
    rms = np.sqrt(np.mean(audio**2))
    target_rms = 10 ** (target_db / 20)
    if rms > 0:
        audio = audio * (target_rms / rms)
    return np.clip(audio, -peak_limit, peak_limit)


def load_audio(
    path: str,
    sample_rate: int = 24000,
    mono: bool = True,
) -> Tuple[np.ndarray, int]:
    """Load audio file with optional resampling."""
    audio, sr = librosa.load(path, sr=sample_rate, mono=mono)
    return audio, sr


def save_audio(
    audio: np.ndarray,
    path: str,
    sample_rate: int = 24000,
) -> None:
    """Save audio file with atomic write semantics."""
    temp_path = f"{path}.tmp"
    try:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        sf.write(temp_path, audio, sample_rate, format="WAV")
        Path(temp_path).replace(path)
    except Exception as exc:
        try:
            Path(temp_path).unlink(missing_ok=True)
        except Exception:
            pass
        raise OSError(f"Failed to save audio to {path}: {exc}") from exc


def trim_tts_output(
    audio: np.ndarray,
    sample_rate: int = 24000,
    frame_ms: int = 20,
    silence_threshold_db: float = -40.0,
    min_silence_ms: int = 200,
    max_internal_silence_ms: int = 1000,
    fade_ms: int = 30,
) -> np.ndarray:
    """Trim trailing silence and post-silence hallucination from TTS output."""
    frame_len = int(sample_rate * frame_ms / 1000)
    if frame_len == 0 or len(audio) < frame_len:
        return audio

    n_frames = len(audio) // frame_len
    threshold_linear = 10 ** (silence_threshold_db / 20)
    rms = np.array(
        [np.sqrt(np.mean(audio[i * frame_len : (i + 1) * frame_len] ** 2)) for i in range(n_frames)]
    )
    is_speech = rms >= threshold_linear

    first_speech = 0
    for i, speech in enumerate(is_speech):
        if speech:
            first_speech = max(0, i - 1)
            break

    max_silence_frames = int(max_internal_silence_ms / frame_ms)
    consecutive_silence = 0
    cut_frame = n_frames
    for i in range(first_speech, n_frames):
        if is_speech[i]:
            consecutive_silence = 0
        else:
            consecutive_silence += 1
            if consecutive_silence >= max_silence_frames:
                cut_frame = i - consecutive_silence + 1
                break

    min_silence_frames = int(min_silence_ms / frame_ms)
    end_frame = cut_frame
    while end_frame > first_speech and not is_speech[end_frame - 1]:
        end_frame -= 1
    end_frame = min(end_frame + min_silence_frames, cut_frame)

    start_sample = first_speech * frame_len
    end_sample = min(end_frame * frame_len, len(audio))
    trimmed = audio[start_sample:end_sample].copy()

    fade_samples = int(sample_rate * fade_ms / 1000)
    if fade_samples > 0 and len(trimmed) > fade_samples:
        fade = np.cos(np.linspace(0, np.pi / 2, fade_samples)) ** 2
        trimmed[-fade_samples:] *= fade

    return trimmed


def validate_reference_audio(
    audio_path: str,
    min_duration: float = 2.0,
    max_duration: float = 30.0,
    min_rms: float = 0.01,
) -> Tuple[bool, Optional[str]]:
    """Validate reference audio for voice cloning."""
    valid, error, _audio, _sr = validate_and_load_reference_audio(
        audio_path,
        min_duration=min_duration,
        max_duration=max_duration,
        min_rms=min_rms,
    )
    return valid, error


def validate_and_load_reference_audio(
    audio_path: str,
    min_duration: float = 2.0,
    max_duration: float = 30.0,
    min_rms: float = 0.01,
) -> Tuple[bool, Optional[str], Optional[np.ndarray], Optional[int]]:
    """Validate and load reference audio in a single pass."""
    try:
        audio, sr = load_audio(audio_path)
        duration = len(audio) / sr
        if duration < min_duration:
            return False, f"Audio too short (minimum {min_duration} seconds)", None, None
        if duration > max_duration:
            return False, f"Audio too long (maximum {max_duration} seconds)", None, None

        rms = np.sqrt(np.mean(audio**2))
        if rms < min_rms:
            return False, "Audio is too quiet or silent", None, None
        if np.abs(audio).max() > 0.99:
            return False, "Audio is clipping (reduce input gain)", None, None

        return True, None, audio, sr
    except Exception as exc:
        return False, f"Error validating audio: {exc}", None, None
