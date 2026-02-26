from __future__ import annotations

import subprocess
import time
from pathlib import Path
from typing import Optional

import requests


class VoiceboxManagerError(RuntimeError):
    """Raised when managed Voicebox startup fails."""


def ensure_voicebox_ready(
    voicebox_url: str,
    logger,
    manage_voicebox: bool = False,
    start_command: str | None = None,
    workdir: Path | None = None,
    timeout_sec: float = 45.0,
) -> Optional[subprocess.Popen]:
    if not manage_voicebox:
        raise VoiceboxManagerError(
            "Managed Voicebox mode is required for TTS renders. "
            "Enable --manage-voicebox."
        )

    if not start_command:
        raise VoiceboxManagerError(
            "Managed Voicebox is enabled but no start command was provided. "
            "Set --voicebox-start-command."
        )

    if _is_voicebox_reachable(voicebox_url):
        raise VoiceboxManagerError(
            f"Voicebox is already running at {voicebox_url}. "
            "Stop external Voicebox first so VibeTube can manage startup itself."
        )

    logger.info("Voicebox not reachable. Starting managed Voicebox process.")
    process = subprocess.Popen(
        start_command,
        shell=True,
        cwd=str(workdir) if workdir else None,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    deadline = time.time() + max(1.0, timeout_sec)
    while time.time() < deadline:
        if process.poll() is not None:
            raise VoiceboxManagerError(
                "Managed Voicebox process exited before becoming healthy. "
                f"Command: {start_command}"
            )
        if _is_voicebox_reachable(voicebox_url):
            logger.info("Managed Voicebox is ready at %s", voicebox_url)
            return process
        time.sleep(1.0)

    raise VoiceboxManagerError(
        "Timed out waiting for managed Voicebox startup "
        f"after {timeout_sec:.1f}s at {voicebox_url}."
    )


def _is_voicebox_reachable(voicebox_url: str) -> bool:
    base = voicebox_url.rstrip("/")
    probes = (
        f"{base}/health",
        f"{base}/profiles",
        f"{base}/docs",
    )

    for url in probes:
        try:
            response = requests.get(url, timeout=2.5)
            if response.status_code < 500:
                return True
        except requests.RequestException:
            continue
    return False
