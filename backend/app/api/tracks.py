import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from ..db import get_session
from ..deps import get_current_user
from ..models import Track, User
from ..schemas import TrackCreateRequest, TrackResponse, TrackShareResponse

router = APIRouter(prefix="/api/tracks", tags=["tracks"])


@router.get("", response_model=list[TrackResponse])
def list_tracks(session: Session = Depends(get_session)):
    query = (
        select(Track)
        .where((Track.is_published) | (Track.source == "system"))
        .order_by(Track.created_at.desc())
    )
    tracks = session.exec(query).all()
    return [
        TrackResponse(
            id=str(track.id),
            slug=track.slug,
            name=track.name,
            source=track.source,
            is_published=track.is_published,
            share_token=track.share_token,
            created_at=track.created_at,
        )
        for track in tracks
    ]


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

    return TrackResponse(
        id=str(track.id),
        slug=track.slug,
        name=track.name,
        source=track.source,
        is_published=track.is_published,
        share_token=track.share_token,
        created_at=track.created_at,
    )


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
