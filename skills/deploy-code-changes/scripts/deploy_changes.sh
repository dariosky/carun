#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: deploy_changes.sh --message "<commit message>" [--dry-run] [--skip-deploy]

Run repo-wide pre-commit hooks, commit current changes on main, push origin/main,
and run scripts/deploy.py.
EOF
}

message=""
dry_run=0
skip_deploy=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --message)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --message" >&2
        usage >&2
        exit 1
      fi
      message="$2"
      shift 2
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    --skip-deploy)
      skip_deploy=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$message" ]]; then
  echo "--message is required" >&2
  usage >&2
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

run_cmd() {
  printf '+'
  for arg in "$@"; do
    printf ' %q' "$arg"
  done
  printf '\n'

  if (( dry_run == 0 )); then
    "$@"
  fi
}

run_pre_commit() {
  local attempt
  for attempt in 1 2 3; do
    printf 'Running pre-commit pass %s/3\n' "$attempt"
    if (( dry_run == 1 )); then
      echo '+ pre-commit run --all-files'
      return 0
    fi

    if pre-commit run --all-files; then
      return 0
    fi

    if [[ "$attempt" -eq 3 ]]; then
      echo "pre-commit did not pass after 3 attempts" >&2
      return 1
    fi

    echo "pre-commit reported changes or failures; rerunning..."
  done
}

current_branch="$(git branch --show-current)"
if [[ "$current_branch" != "main" ]]; then
  echo "Current branch is '$current_branch'. This workflow only deploys from 'main'." >&2
  exit 1
fi

if [[ ! -f ".venv/bin/activate" ]]; then
  echo "Missing .venv/bin/activate" >&2
  exit 1
fi

if (( dry_run == 1 )); then
  echo '+ source .venv/bin/activate'
else
  # shellcheck disable=SC1091
  source .venv/bin/activate
fi

run_pre_commit

run_cmd git add -A

if (( dry_run == 0 )) && git diff --cached --quiet; then
  echo "No changes to commit after pre-commit." >&2
  exit 1
fi

run_cmd git commit -m "$message"
run_cmd git push origin main

if (( skip_deploy == 0 )); then
  run_cmd python scripts/deploy.py
fi

if (( dry_run == 0 )); then
  run_cmd git rev-parse --short HEAD
fi
