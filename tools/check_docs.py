"""Validate local Markdown links without network access or extra dependencies."""
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]


def check(root=ROOT):
    files = sorted(root.glob("*.md")) + sorted((root / "docs").rglob("*.md"))
    files += sorted((root / ".github").rglob("*.md"))
    errors = []
    count = 0
    for path in files:
        source = path.read_text(encoding="utf-8")
        source = re.sub(r"```[^\n]*\n.*?```", "", source, flags=re.S)
        for match in re.finditer(r"!?\[[^\]\n]*\]\((<[^>]+>|[^\s)]+)(?:\s+\"[^\"]*\")?\)", source):
            target = match[1].strip("<>")
            parsed = urlsplit(target)
            if parsed.scheme or parsed.netloc or not parsed.path:
                continue
            destination = (path.parent / unquote(parsed.path)).resolve()
            count += 1
            if not destination.is_relative_to(root.resolve()) or not destination.exists():
                errors.append(f"{path.relative_to(root)}: {target}")
    if errors:
        raise ValueError("Broken or external filesystem links:\n" + "\n".join(errors))
    print(f"Validated {count} local links in {len(files)} Markdown documents.")


if __name__ == "__main__":
    check()
