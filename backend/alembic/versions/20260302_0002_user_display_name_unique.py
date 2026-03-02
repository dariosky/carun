"""make user display_name unique

Revision ID: 20260302_0002
Revises: 20260226_0001
Create Date: 2026-03-02 12:00:00

"""

import re

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260302_0002"
down_revision = "20260226_0001"
branch_labels = None
depends_on = None


def _sanitize_display_name(raw: str | None) -> str:
    if not isinstance(raw, str):
        return "PLAYER"
    cleaned = re.sub(r"[^A-Z0-9 ]", "", raw.upper()).strip()[:12]
    return cleaned or "PLAYER"


def _unique_name(base_name: str, taken: set[str]) -> str:
    base = _sanitize_display_name(base_name)
    if base not in taken:
        return base
    suffix = 2
    while suffix < 100000:
        suffix_text = str(suffix)
        trimmed = base[: max(1, 12 - len(suffix_text))]
        candidate = f"{trimmed}{suffix_text}"
        if candidate not in taken:
            return candidate
        suffix += 1
    raise RuntimeError("Could not allocate a unique display name during migration")


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT id, display_name FROM users ORDER BY created_at ASC, id ASC")
    ).mappings()

    taken: set[str] = set()
    for row in rows:
        user_id = row["id"]
        next_name = _unique_name(row["display_name"], taken)
        taken.add(next_name)
        if next_name == row["display_name"]:
            continue
        bind.execute(
            sa.text("UPDATE users SET display_name = :display_name WHERE id = :id"),
            {"id": user_id, "display_name": next_name},
        )

    op.create_index("ix_users_display_name", "users", ["display_name"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_display_name", table_name="users")
