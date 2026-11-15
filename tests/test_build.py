"""Verify deterministic, complete release artifacts and historical retention."""
from pathlib import Path
from zipfile import ZipFile
import hashlib
import importlib.util
import json
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


class BuildTests(unittest.TestCase):
    def fixture(self, root):
        spec = importlib.util.spec_from_file_location("addon_build", ROOT / "tools/build.py")
        builder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(builder)
        (root / "package.json").write_text(json.dumps({"version": "2.0.99"}), encoding="utf-8")
        for pack in ("Grave_B", "Grave_R"):
            (root / pack).mkdir()
            (root / pack / "manifest.json").write_text("{}", encoding="utf-8")
        (root / "NOTICE.md").write_text("Original attribution", encoding="utf-8")
        (root / "docs").mkdir()
        (root / "docs/INSTALL.md").write_text("Installation guide", encoding="utf-8")
        (root / "dist").mkdir()
        builder.ROOT = root
        return builder

    def test_keeps_historical_archives_and_companions_and_updates_current_checksum(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            builder = self.fixture(root)
            historical = {"Gravestones-lanshiyi-v2.0.13.mcaddon": b"historical archive",
                          "Gravestones-lanshiyi-v2.0.13.mcaddon.sha256": b"historical checksum",
                          "release-notes.txt": b"other release material"}
            for name, data in historical.items():
                (root / "dist" / name).write_bytes(data)
            companion = root / "dist/Gravestones-lanshiyi-v2.0.99.mcaddon.sha256"
            companion.write_text("stale checksum", encoding="utf-8")
            output = builder.build()
            for name, data in historical.items():
                self.assertEqual((root / "dist" / name).read_bytes(), data)
            self.assertEqual(companion.read_text(encoding="utf-8").split()[0], hashlib.sha256(output.read_bytes()).hexdigest())

    def test_repeat_build_has_identical_bytes_and_contains_installation_and_attribution(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            builder = self.fixture(root)
            output = builder.build()
            first = output.read_bytes()
            native_info = builder.ZipInfo
            def foreign_platform(*args, **kwargs):
                result = native_info(*args, **kwargs)
                result.create_system = 0 if native_info(*args, **kwargs).create_system != 0 else 3
                return result
            with patch.object(builder, "ZipInfo", side_effect=foreign_platform):
                self.assertEqual(builder.build().read_bytes(), first)
            with ZipFile(output) as archive:
                self.assertEqual(set(archive.namelist()), {"Grave_B/manifest.json", "Grave_R/manifest.json", "NOTICE.md", "INSTALL.md"})
                self.assertEqual(archive.read("NOTICE.md"), b"Original attribution")

    def test_verification_detects_tampered_source_and_checksum(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            builder = self.fixture(root)
            output = builder.build()
            (root / "Grave_B/manifest.json").write_text('{"modified":true}', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "differs from source"):
                builder.verify(output, root)
            output = builder.build()
            output.with_suffix(".mcaddon.sha256").write_text("wrong", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Checksum"):
                builder.verify(output, root)

    def test_unexpected_or_duplicate_archive_entries_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            builder = self.fixture(root)
            output = builder.build()
            with ZipFile(output, "a") as archive:
                archive.writestr("unexpected.txt", "not a release input")
            with self.assertRaisesRegex(ValueError, "entries"):
                builder.verify(output, root)


if __name__ == "__main__":
    unittest.main()
