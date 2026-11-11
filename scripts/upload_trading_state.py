#!/usr/bin/env python3
"""Upload an approved state tarball to a disabled Render fleet service."""
import base64
import json
import os
import sys
import tarfile
import urllib.error
import urllib.request
from pathlib import Path

ALLOWED = {
    "scalperbot.db",
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
}
MAX_TOTAL_BYTES = 8 * 1024 * 1024


def main():
    if len(sys.argv) != 3:
        raise SystemExit(
            "Usage: python scripts/upload_trading_state.py "
            "<state-tar.gz> <https://service.onrender.com>"
        )
    token = os.environ.get("TRADING_MIGRATION_TOKEN")
    if not token:
        raise SystemExit("Set TRADING_MIGRATION_TOKEN in your shell first.")

    archive_path, base_url = Path(sys.argv[1]), sys.argv[2].rstrip("/")
    if not base_url.startswith("https://"):
        raise SystemExit("The service URL must use HTTPS.")

    files = {}
    total = 0
    with tarfile.open(archive_path, "r:gz") as archive:
        for member in archive.getmembers():
            if not member.isfile():
                continue
            name = Path(member.name).name
            if name not in ALLOWED:
                continue
            stream = archive.extractfile(member)
            if stream is None:
                continue
            content = stream.read()
            total += len(content)
            if total > MAX_TOTAL_BYTES:
                raise SystemExit("State archive exceeds the 8 MB safety limit.")
            if name == "scalperbot.db" and not content.startswith(
                b"SQLite format 3\x00"
            ):
                raise SystemExit("Archive contains an invalid SQLite database.")
            files[name] = base64.b64encode(content).decode("ascii")

    if "scalperbot.db" not in files:
        raise SystemExit("Archive does not contain scalperbot.db.")

    payload = json.dumps({"files": files}).encode("utf-8")
    request = urllib.request.Request(
        base_url + "/api/internal/trading-state/import",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "X-Trading-Migration-Token": token,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")
        raise SystemExit(f"State upload failed ({error.code}): {detail}")
    print("State imported:", ", ".join(result.get("files", [])))
    print("Fleet remains disabled; verify the import before arming it.")


if __name__ == "__main__":
    main()
