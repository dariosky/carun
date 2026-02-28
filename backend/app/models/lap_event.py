from datetime import datetime
from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel


class LapEvent(SQLModel, table=True):
    __tablename__ = "lap_events"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    user_id: UUID = Field(foreign_key="users.id", nullable=False, index=True)
    track_id: UUID = Field(foreign_key="tracks.id", nullable=False, index=True)
    lap_ms: int = Field(nullable=False)
    accepted: bool = Field(default=False, index=True)
    reason: str | None = None
    lap_data_checksum: str = Field(default="")
    build_version: str = Field(default="dev")
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
