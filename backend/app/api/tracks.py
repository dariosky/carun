import secrets
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, or_, select

from ..db import get_session
from ..deps import get_current_user, get_optional_current_user
from ..models import BestLap, BestRace, Track, User
from ..schemas import (
    TrackCreateRequest,
    TrackDetailResponse,
    TrackPublishRequest,
    TrackRenameRequest,
    TrackResponse,
    TrackShareResponse,
)

router = APIRouter(prefix="/api/tracks", tags=["tracks"])


def _parse_track_id(track_id: str) -> UUID:
    try:
        return UUID(track_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid track_id")


def _best_lap_for_track(session: Session, track_id: UUID) -> tuple[int | None, str | None]:
    row = session.exec(
        select(BestLap.lap_ms, User.display_name)
        .join(User, User.id == BestLap.user_id)
        .where(BestLap.track_id == track_id)
        .order_by(BestLap.lap_ms.asc(), BestLap.updated_at.asc())
        .limit(1)
    ).first()
    if not row:
        return None, None
    return row[0], row[1]


def _best_race_for_track(session: Session, track_id: UUID) -> tuple[int | None, str | None]:
    row = session.exec(
        select(BestRace.race_ms, User.display_name)
        .join(User, User.id == BestRace.user_id)
        .where(BestRace.track_id == track_id)
        .order_by(BestRace.race_ms.asc(), BestRace.updated_at.asc())
        .limit(1)
    ).first()
    if not row:
        return None, None
    return row[0], row[1]


def _owner_display_name_for_track(session: Session, track: Track) -> str | None:
    if not track.owner_user_id:
        return None
    owner = session.get(User, track.owner_user_id)
    return owner.display_name if owner else None


def _to_track_response(session: Session, track: Track) -> TrackResponse:
    best_lap_ms, best_lap_display_name = _best_lap_for_track(session, track.id)
    best_race_ms, best_race_display_name = _best_race_for_track(session, track.id)
    return TrackResponse(
        id=str(track.id),
        slug=track.slug,
        name=track.name,
        source=track.source,
        is_published=track.is_published,
        share_token=track.share_token,
        owner_user_id=str(track.owner_user_id) if track.owner_user_id else None,
        owner_display_name=_owner_display_name_for_track(session, track),
        best_lap_ms=best_lap_ms,
        best_lap_display_name=best_lap_display_name,
        best_race_ms=best_race_ms,
        best_race_display_name=best_race_display_name,
        created_at=track.created_at,
    )


def _to_track_detail_response(session: Session, track: Track) -> TrackDetailResponse:
    best_lap_ms, best_lap_display_name = _best_lap_for_track(session, track.id)
    best_race_ms, best_race_display_name = _best_race_for_track(session, track.id)
    return TrackDetailResponse(
        id=str(track.id),
        slug=track.slug,
        name=track.name,
        source=track.source,
        is_published=track.is_published,
        share_token=track.share_token,
        owner_user_id=str(track.owner_user_id) if track.owner_user_id else None,
        owner_display_name=_owner_display_name_for_track(session, track),
        best_lap_ms=best_lap_ms,
        best_lap_display_name=best_lap_display_name,
        best_race_ms=best_race_ms,
        best_race_display_name=best_race_display_name,
        created_at=track.created_at,
        track_payload_json=track.track_payload_json,
    )


def _can_access_track(track: Track, current_user: User | None) -> bool:
    if track.source == "system" or track.is_published:
        return True
    if not current_user:
        return False
    return bool(current_user.is_admin or track.owner_user_id == current_user.id)


@router.get("", response_model=list[TrackDetailResponse])
def list_tracks(
    session: Session = Depends(get_session),
    current_user: User | None = Depends(get_optional_current_user),
):
    if current_user and current_user.is_admin:
        query = select(Track).order_by(Track.created_at.desc())
    else:
        visibility = (Track.is_published) | (Track.source == "system")
        if current_user:
            visibility = or_(visibility, Track.owner_user_id == current_user.id)
        query = select(Track).where(visibility).order_by(Track.created_at.desc())

    tracks = session.exec(query).all()
    return [_to_track_detail_response(session, track) for track in tracks]


@router.post("", response_model=TrackResponse, status_code=201)
def create_track(
    payload: TrackCreateRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    track = Track(
        name=payload.name,
        source="user",
        owner_user_id=current_user.id,
        is_published=False,
        share_token=secrets.token_urlsafe(16),
        track_payload_json=payload.track_payload_json,
        updated_at=datetime.utcnow(),
    )
    session.add(track)
    session.commit()
    session.refresh(track)

    return _to_track_response(session, track)


@router.patch("/{track_id}/publish", response_model=TrackResponse)
def set_track_publish_state(
    track_id: str,
    payload: TrackPublishRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin required")

    track = session.get(Track, _parse_track_id(track_id))
    if not track:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")

    track.is_published = payload.is_published
    track.updated_at = datetime.utcnow()
    session.add(track)
    session.commit()
    session.refresh(track)

    return _to_track_response(session, track)


@router.get("/mine", response_model=list[TrackDetailResponse])
def list_my_tracks(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    query = (
        select(Track)
        .where(Track.owner_user_id == current_user.id)
        .order_by(Track.created_at.desc())
    )
    tracks = session.exec(query).all()
    return [_to_track_detail_response(session, track) for track in tracks]


@router.get("/share/{share_token}", response_model=TrackShareResponse)
def get_shared_track(share_token: str, session: Session = Depends(get_session)):
    track = session.exec(select(Track).where(Track.share_token == share_token)).first()
    if not track:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")

    return TrackShareResponse(
        id=str(track.id),
        name=track.name,
        source=track.source,
        track_payload_json=track.track_payload_json,
    )


@router.get("/{track_id}", response_model=TrackDetailResponse)
def get_track_by_id(
    track_id: str,
    session: Session = Depends(get_session),
    current_user: User | None = Depends(get_optional_current_user),
):
    track = session.get(Track, _parse_track_id(track_id))
    if not track:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")

    if not _can_access_track(track, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")

    return _to_track_detail_response(session, track)


@router.patch("/{track_id}", response_model=TrackResponse)
def rename_track(
    track_id: str,
    payload: TrackRenameRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    track = session.get(Track, _parse_track_id(track_id))
    if not track:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")

    allowed = bool(current_user.is_admin or track.owner_user_id == current_user.id)
    if not allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")

    trimmed_name = payload.name.strip()
    if not trimmed_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Track name required"
        )

    track.name = trimmed_name
    track.updated_at = datetime.utcnow()
    session.add(track)
    session.commit()
    session.refresh(track)
    return _to_track_response(session, track)


@router.delete("/{track_id}", status_code=204)
def delete_track(
    track_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    track = session.get(Track, _parse_track_id(track_id))
    if not track:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")
    if track.owner_user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")
    if track.is_published:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Published tracks cannot be deleted",
        )

    session.delete(track)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Track cannot be deleted because it has related race data",
        )
