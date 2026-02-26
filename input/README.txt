Drop files here:
- input/audio/voice.wav
- input/avatar_pack/idle.png
- input/avatar_pack/talk.png
- input/avatar_pack/idle_blink.png (optional)
- input/avatar_pack/talk_blink.png (optional)
- input/avatar_pack/blink.png (optional legacy fallback)

Then run:
vibetube render --input-wav .\input\audio\voice.wav --text .\input\script.txt --avatar .\input\avatar_pack --out .\output --fps 30 --width 512 --height 512 --format webm
