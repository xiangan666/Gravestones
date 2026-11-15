"""Exercise draft discovery and annotated tag resolution without GitHub access."""
from pathlib import Path
import importlib.util
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
try:
    spec = importlib.util.spec_from_file_location("release_tool", ROOT / "tools/release.py")
    release_tool = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(release_tool)
finally:
    sys.path.pop(0)


class ReleaseTests(unittest.TestCase):
    def test_discovers_draft_by_tag_even_when_it_is_not_the_first_release(self):
        first = [{"tag_name": f"v1.0.{n}", "draft": False} for n in range(100)]
        draft = {"id": 42, "tag_name": "v2.0.99", "draft": True}
        with patch.object(release_tool, "api", side_effect=[first, [draft]]) as request:
            self.assertEqual(release_tool.find_release("owner/repo", "v2.0.99"), draft)
            self.assertEqual(request.call_args[0][0], "repos/owner/repo/releases?per_page=100&page=2")

    def test_missing_release_stops_after_the_last_page(self):
        with patch.object(release_tool, "api", return_value=[]) as request:
            self.assertIsNone(release_tool.find_release("owner/repo", "v2.0.99"))
            request.assert_called_once()

    def test_resolves_annotated_remote_tag_to_commit_and_rejects_other_objects(self):
        with patch.object(release_tool, "api", side_effect=[{"object": {"type": "tag", "sha": "tag-object"}}, {"object": {"type": "commit", "sha": "candidate-commit"}}]):
            self.assertEqual(release_tool.remote_commit("owner/repo", "v2.0.99"), "candidate-commit")
        with patch.object(release_tool, "api", return_value={"object": {"type": "tree", "sha": "unexpected"}}):
            with self.assertRaisesRegex(ValueError, "commit"):
                release_tool.remote_commit("owner/repo", "v2.0.99")
