"""Reproducible mcaddon packaging. The original archive is never modified."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]


def build():
    version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    output = ROOT / "dist" / f"Gravestones-lanshiyi-v{version}.mcaddon"
    output.parent.mkdir(exist_ok=True)
    with ZipFile(output, "w", ZIP_DEFLATED, compresslevel=9) as archive:
        for pack in ("Grave_B", "Grave_R"):
            for path in sorted((ROOT / pack).rglob("*")):
                if not path.is_file():
                    continue
                entry = ZipInfo(path.relative_to(ROOT).as_posix(), (2026, 11, 9, 0, 0, 0))
                entry.compress_type = ZIP_DEFLATED
                entry.external_attr = 0o100644 << 16
                archive.writestr(entry, path.read_bytes())
    checksum = hashlib.sha256(output.read_bytes()).hexdigest()
    # Keep every older version and its companion files for rollback/comparison.
    # Only the explicitly requested version's archive is written on this build.
    print(f"Built {output.name} ({output.stat().st_size:,} bytes)\nSHA-256 {checksum}")
    return output


if __name__ == "__main__":
    build()
