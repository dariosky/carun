"""initial schema

Revision ID: 20260226_0001
Revises:
Create Date: 2026-02-26 22:55:00

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260226_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("google_sub", sa.String(), nullable=False),
        sa.Column("display_name", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_users_id", "users", ["id"])
    op.create_index("ix_users_google_sub", "users", ["google_sub"], unique=True)

    op.create_table(
        "tracks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("slug", sa.String(), nullable=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column(
            "owner_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True
        ),
        sa.Column("is_published", sa.Boolean(), nullable=False),
        sa.Column("share_token", sa.String(), nullable=True),
        sa.Column("min_lap_ms", sa.Integer(), nullable=False),
        sa.Column("track_payload_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_tracks_id", "tracks", ["id"])
    op.create_index("ix_tracks_slug", "tracks", ["slug"], unique=True)
    op.create_index("ix_tracks_source", "tracks", ["source"])
    op.create_index("ix_tracks_is_published", "tracks", ["is_published"])
    op.create_index("ix_tracks_share_token", "tracks", ["share_token"], unique=True)

    op.create_table(
        "best_laps",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
        ),
        sa.Column(
            "track_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tracks.id"), nullable=False
        ),
        sa.Column("lap_ms", sa.Integer(), nullable=False),
        sa.Column("build_version", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("user_id", "track_id", name="uq_best_laps_user_track"),
    )
    op.create_index("ix_best_laps_id", "best_laps", ["id"])
    op.create_index("ix_best_laps_user_id", "best_laps", ["user_id"])
    op.create_index("ix_best_laps_track_id", "best_laps", ["track_id"])
    op.create_index("ix_best_laps_lap_ms", "best_laps", ["lap_ms"])

    op.create_table(
        "lap_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
        ),
        sa.Column(
            "track_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tracks.id"), nullable=False
        ),
        sa.Column("lap_ms", sa.Integer(), nullable=False),
        sa.Column("accepted", sa.Boolean(), nullable=False),
        sa.Column("reason", sa.String(), nullable=True),
        sa.Column("lap_data_checksum", sa.String(), nullable=False),
        sa.Column("build_version", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_lap_events_id", "lap_events", ["id"])
    op.create_index("ix_lap_events_user_id", "lap_events", ["user_id"])
    op.create_index("ix_lap_events_track_id", "lap_events", ["track_id"])
    op.create_index("ix_lap_events_accepted", "lap_events", ["accepted"])


def downgrade() -> None:
    op.drop_index("ix_lap_events_accepted", table_name="lap_events")
    op.drop_index("ix_lap_events_track_id", table_name="lap_events")
    op.drop_index("ix_lap_events_user_id", table_name="lap_events")
    op.drop_index("ix_lap_events_id", table_name="lap_events")
    op.drop_table("lap_events")

    op.drop_index("ix_best_laps_lap_ms", table_name="best_laps")
    op.drop_index("ix_best_laps_track_id", table_name="best_laps")
    op.drop_index("ix_best_laps_user_id", table_name="best_laps")
    op.drop_index("ix_best_laps_id", table_name="best_laps")
    op.drop_table("best_laps")

    op.drop_index("ix_tracks_share_token", table_name="tracks")
    op.drop_index("ix_tracks_is_published", table_name="tracks")
    op.drop_index("ix_tracks_source", table_name="tracks")
    op.drop_index("ix_tracks_slug", table_name="tracks")
    op.drop_index("ix_tracks_id", table_name="tracks")
    op.drop_table("tracks")

    op.drop_index("ix_users_google_sub", table_name="users")
    op.drop_index("ix_users_id", table_name="users")
    op.drop_table("users")
