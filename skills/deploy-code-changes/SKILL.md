---
name: deploy-code-changes
description: Deploy the current CaRun repository changes by running `pre-commit run --all-files`, choosing a short relevant commit message from the actual diff, committing directly to `main`, pushing `origin/main`, and running `scripts/deploy.py`. Use when the user asks to deploy, ship, publish, or release the current repo changes with the existing production workflow.
---

# Deploy Code Changes

## Workflow

1. Review `git status --short --branch` before doing anything else.
2. Confirm the deploy scope is clear.
If the worktree includes unrelated or ambiguous changes, stop and ask what should be deployed. Do not commit surprise files.
3. Require branch `main`.
If the repo is on another branch, explain that this workflow deploys from `main` and ask before changing branches.
4. Inspect the diff with `git diff --stat` and targeted `git diff` reads as needed.
5. Write a short imperative commit message that matches the actual changes.
Prefer concrete messages such as `tune AI cornering` or `fix lap HUD overlap`.
Avoid vague messages such as `update code` or `misc fixes`.
6. Run the helper from the repo root:

```bash
skills/deploy-code-changes/scripts/deploy_changes.sh --message "<commit message>"
```

7. If the helper fails, report the first failing step and stop.
Do not run `scripts/deploy.py` manually after a failed pre-commit pass or failed push.
8. If the helper succeeds, report the commit SHA and the deploy result.

## Notes

- The helper script sources `.venv/bin/activate` before running Python tooling, matching this repo's rules.
- `scripts/deploy.py` deploys whatever is available on `origin/main`, so pushing `main` is part of the workflow.
- Use `--dry-run` when validating the flow without committing or deploying:

```bash
skills/deploy-code-changes/scripts/deploy_changes.sh --message "test deploy flow" --dry-run
```
