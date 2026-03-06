from pydantic import BaseModel, Field


class LapSubmitRequest(BaseModel):
    track_id: str
    lap_ms: int = Field(gt=0)
    completed: bool = True
    checkpoint_count: int = Field(ge=0)
    expected_checkpoint_count: int = Field(ge=0)
    lap_data_checksum: str = ""
    build_version: str = "dev"


class LapSubmitResponse(BaseModel):
    accepted: bool
    reason: str | None = None
    best_lap_ms: int | None = None


class RaceSubmitRequest(BaseModel):
    track_id: str
    race_ms: int = Field(gt=0)
    lap_count: int = Field(gt=0)
    completed: bool = True
    build_version: str = "dev"


class RaceSubmitResponse(BaseModel):
    accepted: bool
    reason: str | None = None
    best_race_ms: int | None = None


class LeaderboardEntry(BaseModel):
    rank: int
    user_id: str
    display_name: str
    lap_ms: int


class LeaderboardResponse(BaseModel):
    track_id: str
    entries: list[LeaderboardEntry]
