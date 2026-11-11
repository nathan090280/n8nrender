#!/usr/bin/env bash
set -euo pipefail

HOST="${SCALPERBOT_SSH_HOST:-root@2.31.179.70}"
KEY="${SCALPERBOT_SSH_KEY:-$HOME/.ssh/scalperbot_key}"
OUT_DIR="${1:-backups}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
REMOTE_ARCHIVE="/tmp/scalperbot-state-${STAMP}.tgz"

mkdir -p "$OUT_DIR"

ssh -i "$KEY" "$HOST" \
  "cd /opt/scalperbot/deploy && docker compose exec -T scalperbot-grokky python - '$STAMP'" \
  <<'PY'
import shutil
import sqlite3
import sys
import tarfile
from pathlib import Path

stamp = sys.argv[1]
source = Path("/app/state")
stage = Path(f"/tmp/scalperbot-state-{stamp}")
archive = Path(f"/tmp/scalperbot-state-{stamp}.tgz")
stage.mkdir(mode=0o700, exist_ok=False)

src = sqlite3.connect(source / "scalperbot.db")
dst = sqlite3.connect(stage / "scalperbot.db")
src.backup(dst)
dst.close()
src.close()

names = [
    "qualification.json",
    "qualification-new.json",
    "qualification-claude.json",
    "qualification-swing.json",
    "grokky_positions.json",
    "grokky_state.json",
    "longshort_positions.json",
    "longshort_positions.json.state",
    "ranger_positions.json",
    "ranger_state.json",
    "short_positions.json",
    "short_positions.json.state",
]
for name in names:
    path = source / name
    if path.is_file():
        shutil.copy2(path, stage / name)

with tarfile.open(archive, "w:gz") as out:
    for path in sorted(stage.iterdir()):
        out.add(path, arcname=path.name)
print(archive.name)
PY

ssh -i "$KEY" "$HOST" \
  "cd /opt/scalperbot/deploy && CID=\$(docker compose ps -q scalperbot-grokky) && docker cp \"\$CID:$REMOTE_ARCHIVE\" \"$REMOTE_ARCHIVE\""

scp -i "$KEY" "$HOST:$REMOTE_ARCHIVE" "$OUT_DIR/"
printf 'State snapshot copied to %s/%s\n' "$OUT_DIR" "$(basename "$REMOTE_ARCHIVE")"
