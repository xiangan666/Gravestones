"""Publish a verified tag through a resumable draft, then check downloaded assets."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import subprocess
import tempfile

from build import artifact_path, verify

ROOT = Path(__file__).resolve().parents[1]


def command(*args):
    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    if result.returncode:
        raise RuntimeError(f"{args[0]} failed ({result.returncode}): {result.stderr.strip()}")
    return result.stdout.strip()


def gh(*args):
    return command(os.environ.get("GRAVESTONES_GH", "gh"), *args)


def api(endpoint, missing=False):
    try:
        return json.loads(gh("api", endpoint))
    except RuntimeError as error:
        if missing and "HTTP 404" in str(error):
            return None
        raise


def remote_commit(repository, tag):
    ref = api(f"repos/{repository}/git/ref/tags/{tag}")["object"]
    for _ in range(5):
        if ref["type"] == "commit":
            return ref["sha"]
        if ref["type"] != "tag":
            break
        ref = api(f"repos/{repository}/git/tags/{ref['sha']}")["object"]
    raise ValueError("The remote release tag does not resolve to a commit.")


def verify_downloads(repository, tag, release, assets):
    actual = {entry["name"]: entry for entry in release["assets"]}
    expected = {path.name for path in assets}
    if set(actual) != expected:
        raise ValueError(f"Unexpected remote asset list: {sorted(actual)}; expected {sorted(expected)}")
    with tempfile.TemporaryDirectory(prefix="Gravestones-release-verify-") as folder:
        gh("release", "download", tag, "--repo", repository, "--dir", folder)
        results = []
        for path in assets:
            downloaded = Path(folder) / path.name
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            if actual[path.name]["size"] != path.stat().st_size or downloaded.read_bytes() != path.read_bytes():
                raise ValueError(f"Downloaded asset differs from the local candidate: {path.name}")
            if actual[path.name].get("digest") not in (None, f"sha256:{digest}"):
                raise ValueError(f"GitHub asset digest mismatch: {path.name}")
            results.append({"name": path.name, "bytes": path.stat().st_size, "sha256": digest})
        return results


def publish(repository, tag, verify_only=False):
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ValueError("Use an explicit GitHub owner/repository.")
    version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    if tag != f"v{version}":
        raise ValueError("Release tag must match package.json.")
    if command("git", "status", "--porcelain"):
        raise ValueError("Commit the reviewed candidate before publishing.")
    commit = command("git", "rev-parse", "HEAD")
    if remote_commit(repository, tag) != commit:
        raise ValueError("Remote tag and the checked-out candidate commit differ.")
    archive = artifact_path(ROOT)
    verify(archive, ROOT)
    assets = [archive, archive.with_suffix(archive.suffix + ".sha256")]
    endpoint = f"repos/{repository}/releases/tags/{tag}"
    release = api(endpoint, missing=True)
    if verify_only and (not release or release["draft"]):
        raise ValueError("No published release exists for verification.")
    if not verify_only and (not release or release["draft"]):
        notes = (ROOT / f"docs/RELEASE-{version}.md").read_text(encoding="utf-8")
        # Relative documentation links must work from the Release page too.
        notes = re.sub(r"\]\((?!https?://|#)([^)]+\.md)(#[^)]*)?\)",
                       lambda m: f"](https://github.com/{repository}/blob/{tag}/docs/{m[1]}{m[2] or ''})", notes)
        with tempfile.TemporaryDirectory(prefix="Gravestones-release-notes-") as folder:
            notes_path = Path(folder) / "notes.md"
            notes_path.write_text(notes, encoding="utf-8")
            if not release:
                gh("release", "create", tag, "--repo", repository, "--draft", "--verify-tag", "--title", f"墓碑模组 {version}", "--notes-file", str(notes_path))
            else:
                gh("release", "edit", tag, "--repo", repository, "--title", f"墓碑模组 {version}", "--notes-file", str(notes_path))
        gh("release", "upload", tag, *(str(path) for path in assets), "--repo", repository, "--clobber")
        release = api(endpoint)
        verify_downloads(repository, tag, release, assets)
        gh("release", "edit", tag, "--repo", repository, "--draft=false", "--prerelease=false", "--latest")
        release = api(endpoint)
    if release["draft"] or release["prerelease"] or release["tag_name"] != tag:
        raise ValueError("Release is not published as the expected stable version.")
    if remote_commit(repository, tag) != commit:
        raise ValueError("Remote tag changed during publishing.")
    verified = verify_downloads(repository, tag, release, assets)
    report = {"repository": repository, "version": version, "tag": tag, "commit": commit,
              "release": release["html_url"], "publishedAt": release["published_at"], "assets": verified}
    report_path = ROOT / "dist" / f"release-{tag}.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    publish(args.repository, args.tag, args.verify_only)
