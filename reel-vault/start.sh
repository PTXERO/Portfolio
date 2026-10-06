#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
#  SEARCH//NET — one-step launcher for macOS and Linux
#
#  Does everything, then starts the server:
#    1. installs Python (or updates it) — Homebrew on Mac, apt/dnf/pacman on Linux
#    2. installs Git and ffmpeg if they're missing
#    3. downloads the project, or updates it if you already have it
#    4. installs / updates the Python packages in a private venv (reel-vault/.venv)
#    5. starts the auto-updating launcher (run.py)
#
#  First time, paste this into Terminal:
#    curl -fsSL https://raw.githubusercontent.com/PTXERO/Portfolio/claude/new-session-7sf9nm/reel-vault/start.sh | bash
#
#  After that:  bash reel-vault/start.sh   (from the project folder)
#
#  Settings (optional):
#    REELVAULT_DIR=~/Portfolio          where the project lives
#    REELVAULT_BRANCH=main              branch to track
#    REELVAULT_NO_SYSTEM_UPDATE=1       skip the Python / Git / ffmpeg update check
#  Anything you pass goes to the server, e.g.  bash reel-vault/start.sh --port 9000
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_URL="https://github.com/PTXERO/Portfolio"
BRANCH="${REELVAULT_BRANCH:-claude/new-session-7sf9nm}"   # switch to main once merged

say()  { printf '  \033[36m%s\033[0m\n' "$*"; }
warn() { printf '  \033[33m! %s\033[0m\n' "$*"; }
fail() { printf '\n  \033[31mx %s\033[0m\n\n' "$*"; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

OS="$(uname -s)"
SUDO=""; [ "$(id -u)" -ne 0 ] && have sudo && SUDO="sudo"

# install packages with whatever this system uses
pkg_install() {   # pkg_install <brew names> -- <apt names> -- <dnf names> -- <pacman names>
  local brew=() apt=() dnf=() pac=() which=brew
  for a in "$@"; do
    if [ "$a" = "--" ]; then case $which in brew) which=apt;; apt) which=dnf;; dnf) which=pac;; esac; continue; fi
    case $which in brew) brew+=("$a");; apt) apt+=("$a");; dnf) dnf+=("$a");; pac) pac+=("$a");; esac
  done
  if [ "$OS" = "Darwin" ]; then
    have brew || fail "Homebrew is needed to install ${brew[*]}. Install it from https://brew.sh, then run this again."
    brew install "${brew[@]}"
  elif have apt-get; then $SUDO apt-get update -qq && $SUDO apt-get install -y "${apt[@]}"
  elif have dnf;     then $SUDO dnf install -y "${dnf[@]}"
  elif have pacman;  then $SUDO pacman -S --needed --noconfirm "${pac[@]}"
  else fail "Couldn't find a package manager. Install ${apt[*]} yourself, then run this again."
  fi
}

printf '\n  \033[31mSEARCH//NET setup\033[0m\n\n'

# ── 1. Python ───────────────────────────────────────────────
if ! have python3 || ! python3 -c 'import venv' >/dev/null 2>&1; then
  say "installing Python…"
  pkg_install python -- python3 python3-venv python3-pip -- python3 python3-pip -- python python-pip
elif [ -z "${REELVAULT_NO_SYSTEM_UPDATE:-}" ]; then
  say "checking for a newer Python…"
  if [ "$OS" = "Darwin" ]; then { have brew && brew upgrade python >/dev/null 2>&1; } || true
  elif have apt-get; then { ${SUDO:+$SUDO -n} apt-get install -y -qq --only-upgrade python3 >/dev/null 2>&1; } || true
  elif have dnf;     then { ${SUDO:+$SUDO -n} dnf upgrade -y -q python3 >/dev/null 2>&1; } || true
  fi
fi
have python3 || fail "Python still isn't available. Install Python 3 from https://python.org, then run this again."
say "python: $(python3 --version 2>&1)"

# ── 2. Git and ffmpeg ───────────────────────────────────────
have git || { say "installing Git…"; pkg_install git -- git -- git -- git; }
have ffmpeg || { say "installing ffmpeg (thumbnails + joining video/audio)…"; pkg_install ffmpeg -- ffmpeg -- ffmpeg -- ffmpeg || warn "ffmpeg not installed: thumbnails and some downloads will be limited."; }

# ── 3. the project ──────────────────────────────────────────
# use the copy this script lives in, else REELVAULT_DIR, else ~/Portfolio
HERE=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; fi
if [ -n "$HERE" ] && [ -d "$HERE/../.git" ]; then REPO="$(cd "$HERE/.." && pwd)"
else REPO="${REELVAULT_DIR:-$HOME/Portfolio}"; fi

if [ ! -d "$REPO/.git" ]; then
  if [ -d "$REPO" ] && [ -n "$(ls -A "$REPO" 2>/dev/null)" ]; then fail "$REPO exists but isn't a git copy of the project. Move it, or set REELVAULT_DIR."; fi
  say "downloading the project to $REPO…"
  git clone --branch "$BRANCH" "$REPO_URL" "$REPO"
else
  say "updating the project in $REPO…"
  git -C "$REPO" fetch origin "$BRANCH" || warn "couldn't reach GitHub; starting with what you have."
  [ "$(git -C "$REPO" rev-parse --abbrev-ref HEAD)" = "$BRANCH" ] || git -C "$REPO" checkout "$BRANCH"
  git -C "$REPO" pull --ff-only origin "$BRANCH" || warn "couldn't fast-forward (local changes?). Starting with what you have."
fi

# ── 4. Python packages (private venv) ───────────────────────
VENV="$REPO/reel-vault/.venv"
if ! "$VENV/bin/python" -c 'import sys' >/dev/null 2>&1; then   # missing, or broken by a Python upgrade
  say "creating a private Python environment…"
  rm -rf "$VENV"; python3 -m venv "$VENV"
fi
PY="$VENV/bin/python"
say "installing / updating packages (yt-dlp, gallery-dl, fastembed)…"
"$PY" -m pip install -q --upgrade pip >/dev/null 2>&1 || true
"$PY" -m pip install -q --upgrade -r "$REPO/reel-vault/server/requirements.txt" fastembed \
  || warn "some packages failed to install; the app will tell you what's missing in SETUP."

# ── 5. start ────────────────────────────────────────────────
printf '\n  \033[31mStarting SEARCH//NET. Leave this window open; Ctrl+C to stop.\033[0m\n\n'
cd "$REPO"
exec "$PY" "$REPO/reel-vault/server/run.py" --branch "$BRANCH" "$@"
