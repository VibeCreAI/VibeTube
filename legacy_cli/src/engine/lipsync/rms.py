from __future__ import annotations

import contextlib
import math
import wave
from collections import deque
from pathlib import Path


def rms_timeline(
    wav_path: Path,
    fps: int,
    duration_sec: float,
    window_ms: int = 20,
    smoothing_windows: int = 5,
    on_threshold: float = 0.05,
    off_threshold: float = 0.03,
    min_hold_frames: int = 2,
) -> list[dict[str, str | int]]:
    if window_ms < 10:
        window_ms = 10
    if window_ms > 20:
        window_ms = 20
    if smoothing_windows < 1:
        smoothing_windows = 1

    window_values = _windowed_rms(wav_path, window_ms)
    if not window_values:
        return [{"frame": 0, "state": "idle"}]

    smoothed = _moving_average(window_values, smoothing_windows)
    states = _hysteresis_states(
        smoothed,
        on_threshold=on_threshold,
        off_threshold=off_threshold,
        min_hold_windows=max(1, min_hold_frames),
    )

    total_frames = max(1, int(math.ceil(duration_sec * fps)))
    return _states_to_frame_changes(states, window_ms, fps, total_frames)


def _windowed_rms(wav_path: Path, window_ms: int) -> list[float]:
    values: list[float] = []
    with contextlib.closing(wave.open(str(wav_path), "rb")) as stream:
        channels = stream.getnchannels()
        sample_width = stream.getsampwidth()
        sample_rate = stream.getframerate()

        if sample_width != 2:
            raise RuntimeError("RMS fallback currently supports 16-bit PCM WAV files.")

        samples_per_window = max(1, int(sample_rate * (window_ms / 1000.0)))

        while True:
            chunk = stream.readframes(samples_per_window)
            if not chunk:
                break
            values.append(_rms_16bit_pcm(chunk, channels))

    return values


def _rms_16bit_pcm(chunk: bytes, channels: int) -> float:
    total = 0.0
    count = 0
    stride = 2 * channels
    for i in range(0, len(chunk) - (len(chunk) % stride), stride):
        sample_sum = 0.0
        for channel in range(channels):
            offset = i + channel * 2
            sample = int.from_bytes(chunk[offset : offset + 2], byteorder="little", signed=True)
            sample_sum += float(sample)
        avg_sample = sample_sum / channels
        normalized = avg_sample / 32768.0
        total += normalized * normalized
        count += 1

    if count == 0:
        return 0.0
    return math.sqrt(total / count)


def _moving_average(values: list[float], n: int) -> list[float]:
    output: list[float] = []
    acc = 0.0
    queue: deque[float] = deque()

    for value in values:
        queue.append(value)
        acc += value
        if len(queue) > n:
            acc -= queue.popleft()
        output.append(acc / len(queue))

    return output


def _hysteresis_states(
    values: list[float],
    on_threshold: float,
    off_threshold: float,
    min_hold_windows: int,
) -> list[str]:
    state = "idle"
    hold = 0
    out: list[str] = []

    for value in values:
        target = state
        if state == "idle" and value >= on_threshold:
            target = "talk"
        elif state == "talk" and value <= off_threshold:
            target = "idle"

        if target != state:
            hold += 1
            if hold >= min_hold_windows:
                state = target
                hold = 0
        else:
            hold = 0

        out.append(state)

    return out


def _states_to_frame_changes(
    window_states: list[str],
    window_ms: int,
    fps: int,
    total_frames: int,
) -> list[dict[str, str | int]]:
    timeline: list[dict[str, str | int]] = [{"frame": 0, "state": "idle"}]
    window_sec = window_ms / 1000.0

    previous = "idle"
    for frame in range(total_frames):
        t = frame / float(fps)
        idx = min(len(window_states) - 1, int(t / window_sec))
        state = window_states[idx]

        if state != previous:
            timeline.append({"frame": frame, "state": state})
            previous = state

    return timeline

