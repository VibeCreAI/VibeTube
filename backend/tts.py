"""TTS inference module - delegates to backend abstraction layer."""

import numpy as np
import io
import soundfile as sf

from .backends import TTSBackend, get_tts_backend, get_tts_backend_for_engine


def get_tts_model(engine: str = "qwen") -> TTSBackend:
    """Get a TTS backend instance for the requested engine."""
    if engine == "qwen":
        return get_tts_backend()
    return get_tts_backend_for_engine(engine)


def unload_tts_model(engine: str = "qwen"):
    """Unload a TTS model to free memory."""
    backend = get_tts_model(engine)
    backend.unload_model()


def audio_to_wav_bytes(audio: np.ndarray, sample_rate: int) -> bytes:
    """Convert audio array to WAV bytes."""
    buffer = io.BytesIO()
    sf.write(buffer, audio, sample_rate, format="WAV")
    buffer.seek(0)
    return buffer.read()
