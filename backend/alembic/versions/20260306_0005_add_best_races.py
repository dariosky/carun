"""add best races table

Revision ID: 20260306_0005
Revises: 20260305_0004
Create Date: 2026-03-06 13:40:00

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260306_0005"
down_revision = "20260305_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "best_races",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
        ),
        sa.Column(
            "track_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tracks.id"), nullable=False
        ),
        sa.Column("race_ms", sa.Integer(), nullable=False),
        sa.Column("build_version", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("user_id", "track_id", name="uq_best_races_user_track"),
    )
    op.create_index("ix_best_races_id", "best_races", ["id"])
    op.create_index("ix_best_races_user_id", "best_races", ["user_id"])
    op.create_index("ix_best_races_track_id", "best_races", ["track_id"])
    op.create_index("ix_best_races_race_ms", "best_races", ["race_ms"])


def downgrade() -> None:
    op.drop_index("ix_best_races_race_ms", table_name="best_races")
    op.drop_index("ix_best_races_track_id", table_name="best_races")
    op.drop_index("ix_best_races_user_id", table_name="best_races")
    op.drop_index("ix_best_races_id", table_name="best_races")
    op.drop_table("best_races")
