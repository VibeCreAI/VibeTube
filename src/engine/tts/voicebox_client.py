from __future__ import annotations

import base64
from pathlib import Path
from urllib.parse import urljoin

import requests


class VoiceboxError(RuntimeError):
    """Raised when Voicebox TTS generation fails."""


def synthesize_with_voicebox(text: str, voicebox_url: str, out_wav: Path, timeout_sec: float = 60.0) -> Path:
    base = voicebox_url.rstrip("/")
    candidates = [
        (f"{base}/v1/tts", {"text": text}),
        (f"{base}/tts", {"text": text}),
        (f"{base}/generate", {"text": text}),
    ]

    last_error = None
    for url, payload in candidates:
        try:
            response = requests.post(url, json=payload, timeout=timeout_sec)
            if response.status_code >= 400:
                last_error = f"{url} responded {response.status_code}"
                continue

            content_type = response.headers.get("content-type", "")
            if "audio" in content_type or response.content.startswith(b"RIFF"):
                out_wav.write_bytes(response.content)
                return out_wav

            data = response.json()
            if _try_write_from_json_payload(data, base, out_wav, timeout_sec):
                return out_wav
            last_error = f"{url} returned JSON without recognized audio fields"
        except requests.RequestException as exc:
            last_error = str(exc)
        except ValueError:
            last_error = f"{url} returned non-audio, non-JSON response"

    raise VoiceboxError(
        "Could not generate audio via Voicebox. "
        f"Attempted endpoints at {voicebox_url}. Last error: {last_error}"
    )


def _try_write_from_json_payload(data: dict, base_url: str, out_wav: Path, timeout_sec: float) -> bool:
    b64_keys = ("audio_base64", "audio", "wav_base64")
    for key in b64_keys:
        value = data.get(key)
        if isinstance(value, str):
            try:
                out_wav.write_bytes(base64.b64decode(value))
                return True
            except Exception:
                pass

    for key in ("audio_url", "url", "file_url"):
        value = data.get(key)
        if isinstance(value, str):
            resolved = value if value.startswith("http") else urljoin(base_url + "/", value.lstrip("/"))
            response = requests.get(resolved, timeout=timeout_sec)
            response.raise_for_status()
            out_wav.write_bytes(response.content)
            return True

    return False

