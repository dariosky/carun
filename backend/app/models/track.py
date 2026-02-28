from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


class Track(SQLModel, table=True):
    __tablename__ = "tracks"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    slug: str | None = Field(default=None, unique=True, index=True)
    name: str
    source: str = Field(default="system", index=True)
    owner_user_id: UUID | None = Field(default=None, foreign_key="users.id", index=True)
    is_published: bool = Field(default=False, index=True)
    share_token: str | None = Field(default=None, unique=True, index=True)
    min_lap_ms: int = Field(default=8000)
    track_payload_json: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
