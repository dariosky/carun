#!/usr/bin/env python3
"""Deploy CaRun to Opalstack.

Flow:
1. Read `.env.prod`
2. Upload it to remote as `${APP_DIR}/.env`
3. SSH into server and run git pull, migrations, restart, health check
"""

from __future__ import annotations

import argparse
import shlex
import subprocess
from pathlib import Path

REQUIRED_KEYS = [
    "WEBSERVER",
    "SSH_USER",
    "SSH_PORT",
    "APP_DIR",
    "RESTART_CMD",
    "HEALTHCHECK_URL",
]


def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def run(cmd: list[str], dry_run: bool) -> None:
    print("+", " ".join(shlex.quote(c) for c in cmd))
    if not dry_run:
        subprocess.run(cmd, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Deploy CaRun to Opalstack")
    parser.add_argument("--env-file", default=".env.prod", help="Path to production env file")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--skip-migrate", action="store_true")
    parser.add_argument("--skip-restart", action="store_true")
    args = parser.parse_args()

    env_path = Path(args.env_file)
    if not env_path.exists():
        raise SystemExit(f"Missing env file: {env_path}")

    env = parse_env(env_path)
    missing = [k for k in REQUIRED_KEYS if not env.get(k)]
    if missing:
        raise SystemExit(f"Missing required keys in {env_path}: {', '.join(missing)}")

    host = env["WEBSERVER"]
    user = env["SSH_USER"]
    port = env["SSH_PORT"]
    app_dir = env["APP_DIR"]
    restart_cmd = env["RESTART_CMD"]
    health_url = env["HEALTHCHECK_URL"]

    remote = f"{user}@{host}"

    run(
        [
            "scp",
            "-P",
            port,
            str(env_path),
            f"{remote}:{app_dir}/.env",
        ],
        args.dry_run,
    )

    remote_steps = [
        f"cd {shlex.quote(app_dir)}",
        "git pull",
        "uv sync --locked",
    ]

    if not args.skip_migrate:
        remote_steps.append("uv run alembic -c backend/alembic.ini upgrade head")

    if not args.skip_restart:
        remote_steps.append(restart_cmd)

    remote_steps.append(f"curl -fsS {shlex.quote(health_url)}")

    run(["ssh", "-p", port, remote, " && ".join(remote_steps)], args.dry_run)


if __name__ == "__main__":
    main()
