from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel


class BestRace(SQLModel, table=True):
    __tablename__ = "best_races"
    __table_args__ = (UniqueConstraint("user_id", "track_id", name="uq_best_races_user_track"),)

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    user_id: UUID = Field(foreign_key="users.id", nullable=False, index=True)
    track_id: UUID = Field(foreign_key="tracks.id", nullable=False, index=True)
    race_ms: int = Field(nullable=False, index=True)
    build_version: str = Field(default="dev")
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
