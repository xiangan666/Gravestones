"""Regressions for version synchronization and upgrade identity."""
from pathlib import Path
import importlib.util
import json
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("sync_version", ROOT / "tools/sync_version.py")
version_tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(version_tool)


class VersionTests(unittest.TestCase):
    def fixture(self, root):
        for name in ["package.json", "package-lock.json", "Grave_B/manifest.json", "Grave_R/manifest.json", "Grave_B/scripts/core.js"]:
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes((ROOT / name).read_bytes())

    def test_updates_all_versions_without_changing_upgrade_identity_or_runtime_modules(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.fixture(root)
            original = json.loads((root / "Grave_B/manifest.json").read_text(encoding="utf-8"))
            version_tool.sync("2.0.99", root)
            updated = json.loads((root / "Grave_B/manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(updated["header"]["uuid"], original["header"]["uuid"])
            self.assertEqual([entry["uuid"] for entry in updated["modules"]], [entry["uuid"] for entry in original["modules"]])
            self.assertEqual([entry for entry in updated["dependencies"] if "module_name" in entry], [entry for entry in original["dependencies"] if "module_name" in entry])
            for pack in ("Grave_B", "Grave_R"):
                data = json.loads((root / pack / "manifest.json").read_text(encoding="utf-8"))
                self.assertEqual(data["header"]["version"], [2, 0, 99])
                self.assertTrue(all(entry["version"] == [2, 0, 99] for entry in data["modules"] + data["dependencies"] if "uuid" in entry))
            self.assertIn('export const VERSION = "2.0.99";', (root / "Grave_B/scripts/core.js").read_text(encoding="utf-8"))
            lock = json.loads((root / "package-lock.json").read_text(encoding="utf-8"))
            self.assertEqual(lock["packages"][""]["version"], "2.0.99")

    def test_rejects_invalid_versions_and_downgrades_without_partial_writes(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.fixture(root)
            before = {p.relative_to(root): p.read_bytes() for p in root.rglob("*") if p.is_file()}
            for version in ["1.0.0", "2.1", "2.0.99-beta.1", "02.0.99", "../outside"]:
                with self.assertRaises(ValueError):
                    version_tool.sync(version, root)
            self.assertEqual(before, {p.relative_to(root): p.read_bytes() for p in root.rglob("*") if p.is_file()})

    def test_repeated_sync_is_idempotent(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.fixture(root)
            version_tool.sync("2.0.99", root)
            before = {p: p.read_bytes() for p in root.rglob("*") if p.is_file()}
            version_tool.sync("2.0.99", root)
            self.assertEqual(before, {p: p.read_bytes() for p in root.rglob("*") if p.is_file()})
