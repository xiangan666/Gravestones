"""Regressions for keeping historical release artifacts intact."""
from pathlib import Path
import importlib.util
import json
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class BuildRetentionTests(unittest.TestCase):
    def test_keeps_older_archives_and_companion_files(self):
        spec = importlib.util.spec_from_file_location("addon_build", ROOT / "tools/build.py")
        builder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(builder)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "package.json").write_text(json.dumps({"version": "2.0.11"}), encoding="utf-8")
            for pack in ("Grave_B", "Grave_R"):
                (root / pack).mkdir()
                (root / pack / "manifest.json").write_text("{}", encoding="utf-8")
            dist = root / "dist"
            dist.mkdir()
            files = {
                "Gravestones-lanshiyi-v2.0.10.mcaddon": b"old archive unchanged",
                "Gravestones-lanshiyi-v2.0.10.mcaddon.sha256": b"old checksum unchanged",
                "Gravestones-lanshiyi-v2.0.11.mcaddon.sha256": b"existing companion unchanged",
                "release-notes.txt": b"keep other files",
            }
            for name, data in files.items():
                (dist / name).write_bytes(data)
            builder.ROOT = root
            output = builder.build()
            self.assertTrue(output.exists())
            for name, data in files.items():
                self.assertEqual((dist / name).read_bytes(), data)


if __name__ == "__main__":
    unittest.main()
