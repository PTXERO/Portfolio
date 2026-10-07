#!/usr/bin/env python3
"""Publish the REEL//VAULT app to Neocities — uploads only files that changed.

    NEOCITIES_API_KEY=xxxx python tools/neocities_deploy.py            # publish
    NEOCITIES_API_KEY=xxxx python tools/neocities_deploy.py --dry-run  # just show what would change
    NEOCITIES_API_KEY=xxxx python tools/neocities_deploy.py --delete   # also remove deleted files (scoped)

SCOPE: this only ever touches the searchnet/ subtree (minus searchnet/server/).
The rest of ptxero.neocities.org — the homepage, site.config.js, gallery, about,
exposed, ascii-render, rf, social.html, icons — is hand-maintained in the Neocities
editor and is NEVER read, uploaded, or deleted by this tool. --delete likewise only
removes orphans under searchnet/, so it can't wipe the hand-maintained site.

Get the key at neocities.org → Settings → (your site) → API. Standard library only.
"""

import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = os.environ.get("NEOCITIES_API_URL", "https://neocities.org/api")

# This tool manages ONLY the searchnet app on the static host. Everything else on
# the site is hand-maintained in the Neocities editor and must not be touched here.
PUBLISH_ROOTS = ("searchnet/", "hub/", "ptxero-id.js")   # the only paths this tool publishes
# never published: tooling, the local server's code, private data
SKIP_DIRS = {".git", ".github", ".claude", ".venv", "tools", "node_modules", "__pycache__", "data", "models"}
SKIP_FILES = {".gitignore", ".DS_Store", "Thumbs.db"}
SKIP_PATTERNS = ("searchnet/server/", "hub/build/")   # server code runs on the PC; the hub build tooling stays in the repo
# Neocities (free plan) accepts these; anything else is skipped with a note
ALLOWED = set("""apng asc atom avif bin cjs css csv dae eot epub geojson gif glb glsl gltf gpg htm html
ico jpeg jpg js json jxl key kml knowl less manifest map markdown md mf mid midi mjs mtl obj opml osdx
otf pdf pgp pls png py rdf rss sass scss sf2 svg text toml ts tsv ttf txt webapp webmanifest webp woff
woff2 xcf xml xsl xslt yaml yml""".split())
# files Neocities won't take under their real type, published as .txt copies so the
# one-line installers can live on the site:  irm https://ptxero.neocities.org/searchnet/install.txt | iex
PUBLISH_AS = {
    "searchnet/install.txt":    "searchnet/start.ps1",   # Windows (PowerShell)
    "searchnet/install-sh.txt": "searchnet/start.sh",    # macOS / Linux
    "hub/hub-setup.sql.txt":     "hub/hub-setup.sql",      # Neocities refuses .sql; the hub guide fetches this copy
    # the app used to live at /reel-vault/: old bookmarks and old one-line installers still land somewhere useful
    "reel-vault/index.html":     "searchnet/legacy-redirect.html",
    "reel-vault/install.txt":    "searchnet/start.ps1",
    "reel-vault/install-sh.txt": "searchnet/start.sh",
}


def local_files():
    out, skipped = {}, []
    for p in sorted(ROOT.rglob("*")):
        rel = p.relative_to(ROOT).as_posix()
        if p.is_dir() or any(part in SKIP_DIRS for part in p.relative_to(ROOT).parts):
            continue
        if not rel.startswith(PUBLISH_ROOTS):     # only the published subtrees
            continue
        if p.name in SKIP_FILES or rel.startswith(SKIP_PATTERNS) or p.name.startswith("."):
            continue
        if p.suffix.lstrip(".").lower() not in ALLOWED:
            skipped.append(rel)
            continue
        out[rel] = p
    for rel, src in PUBLISH_AS.items():
        if (ROOT / src).is_file():
            out[rel] = ROOT / src
            if src in skipped:
                skipped.remove(src)
    return out, skipped


def call(path, key, data=None, ctype=None, method=None):
    req = urllib.request.Request(API + path, data=data, method=method,
                                 headers={"Authorization": f"Bearer {key}",
                                          **({"Content-Type": ctype} if ctype else {})})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        try:
            return json.loads(body)
        except ValueError:
            return {"result": "error", "message": f"HTTP {e.code}: {body[:200]}"}


def upload(key, batch):
    boundary = uuid.uuid4().hex
    parts = []
    for rel, p in batch:
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{rel}"; '
                     f'filename="{p.name}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode())
        parts.append(p.read_bytes())
        parts.append(b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    return call("/upload", key, b"".join(parts), f"multipart/form-data; boundary={boundary}", "POST")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="show changes, upload nothing")
    ap.add_argument("--delete", action="store_true", help="remove remote files that no longer exist here")
    a = ap.parse_args()
    key = os.environ.get("NEOCITIES_API_KEY", "").strip()
    if not key:
        sys.exit("Set NEOCITIES_API_KEY (neocities.org → Settings → your site → API).")

    remote = call("/list", key)
    if remote.get("result") != "success":
        sys.exit(f"Neocities said: {remote.get('message') or remote}")
    remote_hash = {f["path"]: f.get("sha1_hash") for f in remote["files"] if not f.get("is_directory")}

    files, skipped = local_files()
    changed = [(rel, p) for rel, p in files.items()
               if remote_hash.get(rel) != hashlib.sha1(p.read_bytes()).hexdigest()]
    # only consider deleting remote files INSIDE the published subtree — never the
    # hand-maintained parts of the site (and never the server code we don't publish)
    orphans = sorted(r for r in (set(remote_hash) - set(files))
                     if r.startswith(PUBLISH_ROOTS) and not r.startswith(SKIP_PATTERNS)) if a.delete else []

    info = call("/info", key).get("info", {})
    print(f"site: https://{info.get('sitename', '?')}.neocities.org  ·  {len(files)} files here, "
          f"{len(changed)} changed{f', {len(orphans)} to delete' if a.delete else ''}")
    for rel in skipped:
        print(f"  skip (type not allowed on Neocities): {rel}")
    for rel, _ in changed:
        print(f"  ↑ {rel}")
    for rel in orphans:
        print(f"  ✕ {rel}")
    if a.dry_run or not (changed or orphans):
        print("nothing uploaded" + (" (dry run)" if a.dry_run else " (already up to date)"))
        return

    failed = []
    batch, size = [], 0
    for rel, p in changed + [(None, None)]:
        if rel is not None:
            batch.append((rel, p))
            size += p.stat().st_size
        if batch and (rel is None or len(batch) >= 20 or size > 20_000_000):
            res = upload(key, batch)
            if res.get("result") != "success":
                for one in batch:          # retry one by one so a bad file can't block the rest
                    r1 = upload(key, [one])
                    if r1.get("result") != "success":
                        failed.append((one[0], r1.get("message")))
            batch, size = [], 0
    if orphans:
        body = "&".join("filenames[]=" + urllib.request.quote(o) for o in orphans).encode()
        res = call("/delete", key, body, "application/x-www-form-urlencoded", "POST")
        if res.get("result") != "success":
            failed.append(("(delete)", res.get("message")))
    for rel, msg in failed:
        print(f"  ✕ {rel}: {msg}")
    print(f"done · {len(changed) - len(failed)} uploaded" + (f", {len(failed)} failed" if failed else ""))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
