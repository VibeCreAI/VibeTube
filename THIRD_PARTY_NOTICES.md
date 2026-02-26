# Third-Party Notices

VibeTube integrates with the following third-party projects:

## Voicebox
- Project: https://github.com/jamiepine/voicebox
- License: MIT
- Usage in VibeTube: External REST API integration for TTS generation.
- Notes: VibeTube does not copy Voicebox internals; it calls Voicebox over HTTP.

## PyToon
- Project: https://github.com/lukerbs/pytoon
- License: MIT
- Usage in VibeTube: Optional lip-sync alignment enhancement adapter.
- Notes: If PyToon is unavailable or API-incompatible, VibeTube falls back to RMS-based lip-sync.

