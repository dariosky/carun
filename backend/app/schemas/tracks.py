from datetime import datetime

from pydantic import BaseModel, Field


class TrackCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    track_payload_json: dict


class TrackPublishRequest(BaseModel):
    is_published: bool


class TrackRenameRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class TrackUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    track_payload_json: dict | None = None


class TrackResponse(BaseModel):
    id: str
    slug: str | None = None
    name: str
    source: str
    is_published: bool
    share_token: str | None = None
    owner_user_id: str | None = None
    owner_display_name: str | None = None
    best_lap_ms: int | None = None
    best_lap_display_name: str | None = None
    best_race_ms: int | None = None
    best_race_display_name: str | None = None
    created_at: datetime


class TrackShareResponse(BaseModel):
    id: str
    name: str
    source: str
    track_payload_json: dict


class TrackDetailResponse(BaseModel):
    id: str
    slug: str | None = None
    name: str
    source: str
    is_published: bool
    share_token: str | None = None
    owner_user_id: str | None = None
    owner_display_name: str | None = None
    best_lap_ms: int | None = None
    best_lap_display_name: str | None = None
    best_race_ms: int | None = None
    best_race_display_name: str | None = None
    created_at: datetime
    track_payload_json: dict
