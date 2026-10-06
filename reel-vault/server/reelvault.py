#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────
#  REEL//VAULT — find, learn, sort and save videos from the social web.
#
#  python reel-vault/server/reelvault.py      → open the printed link
#
#  Standard library only; optional tools are detected at startup
#  (gallery-dl, yt-dlp, ffmpeg, fastembed, faster-whisper, tesseract).
#  See reel-vault/README.md.
# ─────────────────────────────────────────────────────────────────
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from rv.web import main  # noqa: E402

if __name__ == "__main__":
    main()
