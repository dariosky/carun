"""add facebook auth fields and user last_seen

Revision ID: 20260305_0004
Revises: 20260304_0003
Create Date: 2026-03-05 22:30:00

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260305_0004"
down_revision = "20260304_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("users", "google_sub", existing_type=sa.String(), nullable=True)
    op.add_column("users", sa.Column("facebook_sub", sa.String(), nullable=True))
    op.add_column("users", sa.Column("last_seen", sa.DateTime(), nullable=True))

    op.create_index("ix_users_facebook_sub", "users", ["facebook_sub"], unique=True)
    op.create_index("ix_users_last_seen", "users", ["last_seen"])


def downgrade() -> None:
    op.drop_index("ix_users_last_seen", table_name="users")
    op.drop_index("ix_users_facebook_sub", table_name="users")
    op.drop_column("users", "last_seen")
    op.drop_column("users", "facebook_sub")

    bind = op.get_bind()
    bind.execute(
        sa.text(
            "UPDATE users"
            " SET google_sub = CONCAT('legacy-google-', id::text)"
            " WHERE google_sub IS NULL"
        )
    )
    op.alter_column("users", "google_sub", existing_type=sa.String(), nullable=False)
