from sqlalchemy import UniqueConstraint
from datetime import datetime
from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel


class BestLap(SQLModel, table=True):
    __tablename__ = "best_laps"
    __table_args__ = (UniqueConstraint("user_id", "track_id", name="uq_best_laps_user_track"),)

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    user_id: UUID = Field(foreign_key="users.id", nullable=False, index=True)
    track_id: UUID = Field(foreign_key="tracks.id", nullable=False, index=True)
    lap_ms: int = Field(nullable=False, index=True)
    build_version: str = Field(default="dev")
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
