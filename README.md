# VibeTube

VibeTube is a CLI-first local rendering tool for PNGtuber overlays.

Pipeline:
- Text -> Voicebox REST TTS (`voice.wav`) OR existing WAV input.
- Lip-sync timeline via optional PyToon adapter or RMS fallback.
- Streamed avatar frame rendering (`idle.png` / `talk.png` / optional `blink.png`).
- Transparent WebM export (VP9 + alpha) or PNG sequence export.
- Caption generation (`captions.srt`) and metadata (`meta.json`).

## Project Layout

```
/vibetube
  /src
    engine/
      tts/
      lipsync/
      timeline/
      renderer/
      exporter/
      captions/
    cli/
    models/
    utils/
  pyproject.toml
  README.md
  LICENSE
  THIRD_PARTY_NOTICES.md
```

## Install

```bash
pip install -e .
```

Requirements:
- Python 3.10+
- `ffmpeg` on PATH (required for `--format webm`)
- Optional: local Voicebox server (default `http://localhost:17493`)
- Optional: `pip install .[pytoon]`

## Avatar Pack

`--avatar` directory must include:
- `idle.png`
- `talk.png`
- optional `idle_blink.png`
- optional `talk_blink.png`
- optional `blink.png` (legacy fallback when specific blink states are not provided)

## CLI Usage

Render using existing WAV (first implementation mode):

```bash
vibetube render \
  --input-wav ./voice.wav \
  --text ./script.txt \
  --avatar ./avatar_pack \
  --out ./output \
  --fps 30 \
  --width 512 \
  --height 512 \
  --format webm
```

Render with Voicebox TTS:

```bash
vibetube render \
  --text ./script.txt \
  --avatar ./avatar_pack \
  --out ./output \
  --fps 30 \
  --width 512 \
  --height 512 \
  --format webm \
  --voicebox-url http://localhost:17493
```

PNG sequence export:

```bash
vibetube render --input-wav ./voice.wav --avatar ./avatar_pack --out ./output --format png
```

## Engine API

Core API exposed for future UI layers:

```python
from engine.job import render_job
from models.config import RenderConfig

result = render_job(RenderConfig(
    avatar_dir=Path("./avatar_pack"),
    out_dir=Path("./output"),
    input_wav=Path("./voice.wav"),
    text_path=Path("./script.txt"),
))
```

The CLI only parses args and calls `render_job(config)`.

## Output Artifacts

- `voice.wav`
- `avatar.webm` (if `--format webm`) or `frames/*.png` (if `--format png`)
- `captions.srt` (when text is provided)
- `timeline.json`
- `meta.json`

## Notes

- Frame rendering and WebM export are streamed; full frame sets are not kept in RAM.
- RMS lip-sync uses 10-20ms windows, smoothing, hysteresis, and hold logic to reduce flicker.
- Voicebox failures are reported with actionable error messages.

