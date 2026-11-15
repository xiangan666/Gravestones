"""Build and verify a deterministic mcaddon plus its version-specific SHA-256 file."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import argparse
import hashlib
import json
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def sources(root=ROOT):
    files = {path.relative_to(root).as_posix(): path for pack in ("Grave_B", "Grave_R") for path in (root / pack).rglob("*") if path.is_file()}
    files.update({"NOTICE.md": root / "NOTICE.md", "INSTALL.md": root / "docs/INSTALL.md"})
    for name, path in files.items():
        if not path.is_file() or not path.resolve().is_relative_to(root.resolve()):
            raise ValueError(f"Missing or external archive source: {name}")
        if path.suffix.lower() in {".tmp", ".bak", ".pyc", ".log"}:
            raise ValueError(f"Unexpected build residue in pack: {name}")
    return files


def artifact_path(root=ROOT):
    version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
    return root / "dist" / f"Gravestones-lanshiyi-v{version}.mcaddon"


def verify(output, root=ROOT):
    expected = sources(root)
    with ZipFile(output) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or set(names) != set(expected):
            raise ValueError("Archive entries do not match the release source list.")
        for name, path in expected.items():
            if archive.read(name) != path.read_bytes():
                raise ValueError(f"Archive differs from source: {name}")
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    checksum = output.with_suffix(output.suffix + ".sha256")
    if checksum.read_text(encoding="utf-8") != f"{digest}  {output.name}\n":
        raise ValueError("Checksum file does not match the archive.")
    print(f"Verified {len(expected)} archive entries and SHA-256: {digest}")
    return digest


def build():
    output = artifact_path(ROOT)
    output.parent.mkdir(exist_ok=True)
    files = sources(ROOT)
    with tempfile.NamedTemporaryFile(dir=output.parent, suffix=".tmp", delete=False) as temporary:
        staged = Path(temporary.name)
    try:
        with ZipFile(staged, "w", ZIP_DEFLATED, compresslevel=9) as archive:
            for name, path in sorted(files.items()):
                entry = ZipInfo(name, (2026, 11, 9, 0, 0, 0))
                entry.compress_type = ZIP_DEFLATED
                entry.external_attr = 0o100644 << 16
                archive.writestr(entry, path.read_bytes())
        checksum = hashlib.sha256(staged.read_bytes()).hexdigest()
        if output.exists() and output.read_bytes() == staged.read_bytes():
            staged.unlink()
        else:
            # Only the current version is replaced; historical releases are retained.
            staged.replace(output)
    finally:
        staged.unlink(missing_ok=True)
    companion = output.with_suffix(output.suffix + ".sha256")
    content = f"{checksum}  {output.name}\n".encode("utf-8")
    if not companion.exists() or companion.read_bytes() != content:
        with tempfile.NamedTemporaryFile(dir=output.parent, suffix=".tmp", delete=False) as temporary:
            temporary.write(content)
            staged_checksum = Path(temporary.name)
        try:
            staged_checksum.replace(companion)
        finally:
            staged_checksum.unlink(missing_ok=True)
    verify(output, ROOT)
    print(f"Built {output.name} ({output.stat().st_size:,} bytes) and {companion.name}")
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", action="store_true", help="Verify the current archive against saved source files and its checksum")
    if parser.parse_args().verify:
        verify(artifact_path(ROOT), ROOT)
    else:
        build()
