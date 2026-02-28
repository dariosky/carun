import os
import re
import subprocess  # nosec: B404
import sys
from pathlib import Path
from urllib.parse import urlparse

"""Sanitize uv.lock so it matches what would be produced without a custom UV_DEFAULT_INDEX.

Current goals:
- Ensure registry lines read: source = { registry = "https://pypi.org/simple" }
- Ensure distribution (sdist / wheel) URLs point to https://files.pythonhosted.org/packages/...
- Convert any URLs that still reference the custom index host (optionally with /simple) to the
  canonical PyPI hosts, without introducing path duplication like /packages/packages/.
- Remove [[tool.uv.index]] blocks from pyproject.toml (unchanged logic).

We purposefully avoid a blanket host replacement to prevent corrupting the structure of
wheel/sdist paths and to keep the two canonical hosts distinct: pypi.org (index) and
files.pythonhosted.org (distributions).
"""

PROJECT_PATH = Path(__file__).parent.parent
LOCK_PATH = PROJECT_PATH / "uv.lock"
PYPROJECT_PATH = PROJECT_PATH / "pyproject.toml"

# Flag to indicate if modifications happened (used in main execution only)
changed = False

# Derive custom host pattern (scheme://host[:port][path-without-trailing-/simple]) from UV_DEFAULT_INDEX
uv_default_index = os.environ.get("UV_DEFAULT_INDEX")
custom_host_pattern = None
if uv_default_index:
    parsed = urlparse(uv_default_index)
    host = parsed.hostname or ""
    port = f":{parsed.port}" if parsed.port else ""
    path = parsed.path or ""
    if path.endswith("/simple"):
        path = path[: -len("/simple")]
    # Normalize any trailing slashes (except root)
    if path != "/":
        path = path.rstrip("/")
    custom_host_pattern = f"{parsed.scheme}://{host}{port}{path}".rstrip("/")

# Helper to sanitize uv.lock content


def sanitize_lock(content: str) -> str:
    original = content

    # 1. Normalize source registry lines.
    # Match lines like: source = { registry = "<anything>/simple" }
    # Replace if host is *not* pypi.org OR is mistakenly files.pythonhosted.org
    def _fix_registry(match: re.Match) -> str:
        url = match.group(1)
        # Always normalize to pypi.org/simple if different
        if url != "https://pypi.org/simple":
            return 'source = { registry = "https://pypi.org/simple" }'
        return match.group(0)

    content = re.sub(
        r'source = { registry = "(https?://[^" ]+/simple)" }', _fix_registry, content
    )

    if custom_host_pattern:
        escaped = re.escape(custom_host_pattern)
        # 2. Transform distribution URLs (sdist / wheel) that still point to the custom host.
        # They can appear as: url = "<custom_host_pattern>[/simple]/packages/..."
        dist_pattern = re.compile(
            r'(url\s*=\s*")' + escaped + r"(?:/simple)?" r'(/packages/[^"\s]+)"'
        )
        content = dist_pattern.sub(r'\1https://files.pythonhosted.org\2"', content)

    # 3a. Collapse any double slash between host and packages path
    content = re.sub(
        r"https://files\.pythonhosted\.org//+(packages/)",
        r"https://files.pythonhosted.org/\1",
        content,
    )
    # 3b. Deduplicate accidental /packages/ repetitions (iterate until stable)
    while "https://files.pythonhosted.org/packages/packages/" in content:
        content = content.replace(
            "https://files.pythonhosted.org/packages/packages/",
            "https://files.pythonhosted.org/packages/",
        )

    # 4. Normalize any legacy incorrect registry lines pointing to distribution host
    content = content.replace(
        'source = { registry = "https://files.pythonhosted.org/simple" }',
        'source = { registry = "https://pypi.org/simple" }',
    )

    return content if content != original else original


def main() -> int:  # pragma: no cover - thin wrapper
    """Entry point when run as a script.

    Returns a process exit code indicating whether a change was made (1) or not (0).
    The non-zero exit when changes occur lets pre-commit / CI stop so the developer can
    review staged modifications.
    """
    global changed
    # Sanitize uv.lock using targeted transformations
    if LOCK_PATH.exists():
        with LOCK_PATH.open("r", encoding="utf-8") as f:
            lock_content = f.read()

        sanitized_lock = sanitize_lock(lock_content)

        if sanitized_lock != lock_content:
            with LOCK_PATH.open("w", encoding="utf-8") as f:
                f.write(sanitized_lock)
            subprocess.run(["git", "add", str(LOCK_PATH)], check=True)  # nosec: B603, B607
            print(
                "Sanitized uv.lock to canonical PyPI registry and distribution URLs; re-staged."
            )
            changed = True

    # Remove all [[tool.uv.index]] sections from pyproject.toml (unchanged logic)
    if PYPROJECT_PATH.exists():
        with PYPROJECT_PATH.open("r", encoding="utf-8") as f:
            pyproject = f.read()
        sanitized_pyproject = re.sub(
            r"(?sm)^\[\[tool\.uv\.index]](?:\n.*?)*(?=^\[|\Z)", "", pyproject
        )
        if sanitized_pyproject != pyproject:
            with PYPROJECT_PATH.open("w", encoding="utf-8") as f:
                f.write(sanitized_pyproject)
            subprocess.run(["git", "add", str(PYPROJECT_PATH)], check=True)  # nosec: B603, B607
            print(
                "Removed [[tool.uv.index]] section(s) from pyproject.toml and re-staged."
            )
            changed = True

    return 1 if changed else 0


if __name__ == "__main__":  # pragma: no cover - manual invocation only
    sys.exit(main())
