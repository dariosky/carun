from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class TournamentTrackPayload(BaseModel):
    id: str = Field(min_length=1, max_length=120)
    name: str = Field(min_length=1, max_length=120)
    track_payload_json: dict


class TournamentAiSlotPayload(BaseModel):
    name: str = Field(min_length=1, max_length=36)
    style: Literal["precise", "long", "bump"]
    color: str = Field(min_length=1, max_length=24)
    top_speed_mul: float = Field(ge=0.8, le=1.0)
    lane_offset: float = 0


class TournamentCreateRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=36)
    player_color: str = Field(min_length=1, max_length=24)
    tracks: list[TournamentTrackPayload] = Field(min_length=1)
    ai_roster: list[TournamentAiSlotPayload] = Field(min_length=1, max_length=5)


class TournamentJoinRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=36)
    player_color: str = Field(min_length=1, max_length=24)
    participant_id: str | None = Field(default=None, max_length=64)


class TournamentRoomSlotResponse(BaseModel):
    slot_id: str
    kind: Literal["human", "ai"]
    display_name: str
    participant_id: str | None = None
    is_host: bool = False
    connected: bool = True
    color: str | None = None
    style: Literal["precise", "long", "bump"] | None = None
    top_speed_mul: float | None = None
    lane_offset: float | None = None


class TournamentRoomResponse(BaseModel):
    id: str
    phase: Literal["lobby", "racing", "standings", "final"]
    paused: bool = False
    paused_by: str | None = None
    current_race_index: int
    tracks: list[TournamentTrackPayload]
    slots: list[TournamentRoomSlotResponse]
    scores: dict[str, int]
    race_results: list[dict[str, dict]]
    created_at: datetime


class TournamentSessionResponse(BaseModel):
    participant_id: str
    room: TournamentRoomResponse
