"""Synchronize the package version without regenerating textures or entity definitions."""
from pathlib import Path
import argparse
import json
import re
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def sync(version=None, root=ROOT):
    package = json.loads((root / "package.json").read_text(encoding="utf-8"))
    previous = package["version"]
    version = version or previous
    if not re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", version):
        raise ValueError("Bedrock pack versions must contain three non-negative integers.")
    parts = list(map(int, version.split(".")))
    if tuple(parts) < tuple(map(int, previous.split("."))):
        raise ValueError("Do not downgrade or rewrite a historical version.")
    package["version"] = version
    lock = json.loads((root / "package-lock.json").read_text(encoding="utf-8"))
    lock["version"] = lock["packages"][""]["version"] = version
    changes = {"package.json": package, "package-lock.json": lock}
    for pack in ("Grave_B", "Grave_R"):
        path = f"{pack}/manifest.json"
        manifest = json.loads((root / path).read_text(encoding="utf-8"))
        manifest["header"]["name"] = re.sub(r"\d+\.\d+\.\d+", version, manifest["header"]["name"])
        manifest["header"]["version"] = parts
        for entry in manifest["modules"] + manifest.get("dependencies", []):
            if "uuid" in entry:
                entry["version"] = parts
        changes[path] = manifest
    pending = {name: (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode("utf-8") for name, data in changes.items()}
    core_path = "Grave_B/scripts/core.js"
    core, count = re.subn(r'export const VERSION = "\d+\.\d+\.\d+";', f'export const VERSION = "{version}";', (root / core_path).read_text(encoding="utf-8"))
    if count != 1:
        raise ValueError("Expected one runtime VERSION declaration.")
    pending[core_path] = core.encode("utf-8")
    pending = {name: content for name, content in pending.items() if (root / name).read_bytes() != content}
    if pending:
        backup = Path(tempfile.mkdtemp(prefix="Gravestones-version-backup-"))
        for name, content in pending.items():
            path = root / name
            original = backup / name
            original.parent.mkdir(parents=True, exist_ok=True)
            original.write_bytes(path.read_bytes())
            with tempfile.NamedTemporaryFile(dir=path.parent, delete=False, suffix=".tmp") as output:
                output.write(content)
                staged = Path(output.name)
            staged.replace(path)
        print(f"Backup: {backup}")
    print(f"Version: {previous} -> {version}; synchronized {len(pending)} files. Update current documentation and release notes before publishing.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version", nargs="?", help="New version, or omit to synchronize package.json's current version")
    sync(parser.parse_args().version)
