from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from ..db import get_session
from ..deps import get_current_user, get_optional_current_user
from ..models import BestLap, LapEvent, Track, User
from ..schemas import LapSubmitRequest, LapSubmitResponse, LeaderboardEntry, LeaderboardResponse

router = APIRouter(prefix="/api", tags=["leaderboard"])


def parse_track_id(track_id: str) -> UUID:
    try:
        return UUID(track_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid track_id")


def can_access_track(track: Track, current_user: User | None) -> bool:
    if track.source == "system" or track.is_published:
        return True
    if not current_user:
        return False
    return bool(current_user.is_admin or track.owner_user_id == current_user.id)


@router.get("/leaderboard/{track_id}", response_model=LeaderboardResponse)
def get_leaderboard(
    track_id: str,
    limit: int = 50,
    session: Session = Depends(get_session),
    current_user: User | None = Depends(get_optional_current_user),
):
    track = session.get(Track, parse_track_id(track_id))
    if not track:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")
    if not can_access_track(track, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")

    stmt = (
        select(BestLap, User)
        .join(User, User.id == BestLap.user_id)
        .where(BestLap.track_id == track.id)
        .order_by(BestLap.lap_ms.asc(), BestLap.updated_at.asc())
        .limit(max(1, min(limit, 100)))
    )
    rows = session.exec(stmt).all()

    entries = [
        LeaderboardEntry(
            rank=i + 1, user_id=str(user.id), display_name=user.display_name, lap_ms=lap.lap_ms
        )
        for i, (lap, user) in enumerate(rows)
    ]
    return LeaderboardResponse(track_id=track_id, entries=entries)


@router.post("/laps", response_model=LapSubmitResponse)
def submit_lap(
    payload: LapSubmitRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    track = session.get(Track, parse_track_id(payload.track_id))
    if not track:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")

    accepted = True
    reason = None

    if not payload.completed:
        accepted = False
        reason = "lap_incomplete"
    elif payload.checkpoint_count != payload.expected_checkpoint_count:
        accepted = False
        reason = "checkpoint_mismatch"
    elif payload.lap_ms < track.min_lap_ms:
        accepted = False
        reason = "lap_too_fast"

    event = LapEvent(
        user_id=current_user.id,
        track_id=track.id,
        lap_ms=payload.lap_ms,
        accepted=accepted,
        reason=reason,
        lap_data_checksum=payload.lap_data_checksum,
        build_version=payload.build_version,
    )
    session.add(event)

    if not accepted:
        session.commit()
        return LapSubmitResponse(accepted=False, reason=reason)

    best = session.exec(
        select(BestLap).where(BestLap.user_id == current_user.id, BestLap.track_id == track.id)
    ).first()

    if not best:
        best = BestLap(
            user_id=current_user.id,
            track_id=track.id,
            lap_ms=payload.lap_ms,
            build_version=payload.build_version,
            updated_at=datetime.utcnow(),
        )
        session.add(best)
    elif payload.lap_ms < best.lap_ms:
        best.lap_ms = payload.lap_ms
        best.build_version = payload.build_version
        best.updated_at = datetime.utcnow()

    session.commit()
    if best:
        session.refresh(best)

    return LapSubmitResponse(accepted=True, best_lap_ms=best.lap_ms if best else payload.lap_ms)
