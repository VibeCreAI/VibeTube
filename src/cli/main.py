from __future__ import annotations

import argparse
import sys
from pathlib import Path

from engine.job import render_job
from models.config import RenderConfig


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="vibetube", description="Local PNGtuber rendering tool")
    subparsers = parser.add_subparsers(dest="command", required=True)

    render = subparsers.add_parser("render", help="Render an avatar video or frame sequence")
    render.add_argument("--text", help="Path to text file OR inline text content")
    render.add_argument("--input-wav", help="Existing WAV file (skips Voicebox generation)")
    render.add_argument("--avatar", required=True, help="Avatar folder with idle.png/talk.png")
    render.add_argument("--out", required=True, help="Output directory")
    render.add_argument("--fps", type=int, default=30)
    render.add_argument("--width", type=int, default=512)
    render.add_argument("--height", type=int, default=512)
    render.add_argument("--format", choices=["webm", "png"], default="webm")
    render.add_argument("--voicebox-url", default="http://localhost:17493")
    render.add_argument("--no-pytoon", action="store_true", help="Disable optional PyToon enhancement")
    render.add_argument("--window-ms", type=int, default=20, help="RMS analysis window in ms (10-20)")
    render.add_argument("--smoothing-windows", type=int, default=5, help="RMS moving average window count")
    render.add_argument("--on-threshold", type=float, default=0.05, help="RMS threshold to switch to talk")
    render.add_argument("--off-threshold", type=float, default=0.03, help="RMS threshold to switch back to idle")
    render.add_argument("--min-hold-frames", type=int, default=2, help="Consecutive windows required before switching")

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command != "render":
        parser.error("Unsupported command")

    text = None
    text_path = None
    if args.text:
        possible = Path(args.text)
        if possible.exists() and possible.is_file():
            text_path = possible
        else:
            text = args.text

    config = RenderConfig(
        avatar_dir=Path(args.avatar),
        out_dir=Path(args.out),
        fps=args.fps,
        width=args.width,
        height=args.height,
        format=args.format,
        voicebox_url=args.voicebox_url,
        text=text,
        text_path=text_path,
        input_wav=Path(args.input_wav) if args.input_wav else None,
        use_pytoon=not args.no_pytoon,
        window_ms=args.window_ms,
        smoothing_windows=args.smoothing_windows,
        on_threshold=args.on_threshold,
        off_threshold=args.off_threshold,
        min_hold_frames=args.min_hold_frames,
    )

    try:
        result = render_job(config)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print(f"Output directory: {result.out_dir}")
    print(f"Audio: {result.audio_path}")
    if result.video_path:
        print(f"Video: {result.video_path}")
    if result.png_dir:
        print(f"PNG frames: {result.png_dir}")
    if result.captions_path:
        print(f"Captions: {result.captions_path}")
    print(f"Meta: {result.meta_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

