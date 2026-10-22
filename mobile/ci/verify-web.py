"""Bind a staged or packaged web directory to the checked build-3 bytes."""

import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("directory", type=Path)
parser.add_argument("manifest", type=Path)
parser.add_argument("--native-shell", action="store_true")
args = parser.parse_args()
root = args.directory.resolve(strict=True)
expected = json.loads(args.manifest.read_text(encoding="utf-8-sig"))
seen = set()
for entry in expected:
    relative = Path(entry["path"])
    path = (root / relative).resolve()
    if not path.is_relative_to(root) or relative.as_posix() in seen:
        raise SystemExit(f"Invalid manifest path: {relative}")
    seen.add(relative.as_posix())
    payload = path.read_bytes()
    if len(payload) != entry["bytes"] or hashlib.sha256(payload).hexdigest() != entry["sha256"]:
        raise SystemExit(f"Build-3 asset mismatch: {relative}")
actual = {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()}
extra = actual - seen
if args.native_shell:
    extra -= {"cordova.js", "cordova_plugins.js"}
if extra:
    raise SystemExit(f"Unexpected assets: {sorted(extra)}")
print(f"Verified {len(seen)} exact build-3 web files in {root}")
