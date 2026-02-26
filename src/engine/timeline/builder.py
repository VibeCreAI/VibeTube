from __future__ import annotations

from typing import Iterator


def state_iterator(total_frames: int, timeline: list[dict[str, str | int]]) -> Iterator[str]:
    if not timeline:
        timeline = [{"frame": 0, "state": "idle"}]

    change_index = 0
    current_state = str(timeline[0]["state"])
    next_change_frame = int(timeline[1]["frame"]) if len(timeline) > 1 else total_frames

    for frame in range(total_frames):
        if frame >= next_change_frame:
            change_index += 1
            current_state = str(timeline[change_index]["state"])
            if change_index + 1 < len(timeline):
                next_change_frame = int(timeline[change_index + 1]["frame"])
            else:
                next_change_frame = total_frames

        yield current_state

