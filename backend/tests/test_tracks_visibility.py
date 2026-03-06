import json
from base64 import b64encode
from uuid import UUID

from app.config import get_settings
from app.models import BestLap, BestRace, Track, User
from itsdangerous import TimestampSigner
from sqlmodel import Session, select


def login_as(client, user: User):
    payload = {
        "user_id": str(user.id),
        "display_name": user.display_name,
        "is_admin": user.is_admin,
    }
    data = b64encode(json.dumps(payload).encode("utf-8"))
    signed = TimestampSigner(get_settings().session_secret).sign(data).decode("utf-8")
    client.cookies.clear()
    client.cookies.set("session", signed)


def logout(client):
    client.cookies.clear()


def create_user(session: Session, name: str, *, is_admin: bool = False) -> User:
    user = User(
        google_sub=f"sub-{name}",
        display_name=name,
        email=f"{name}@example.com",
        is_admin=is_admin,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def create_track(
    session: Session,
    name: str,
    *,
    source: str = "user",
    owner: User | None = None,
    is_published: bool = False,
    share_token: str | None = None,
) -> Track:
    track = Track(
        name=name,
        source=source,
        owner_user_id=owner.id if owner else None,
        is_published=is_published,
        share_token=share_token,
        track_payload_json={"name": name},
    )
    session.add(track)
    session.commit()
    session.refresh(track)
    return track


def track_names(payload):
    return [item["name"] for item in payload]


def test_auth_me_returns_admin_flag(client, session):
    admin = create_user(session, "ADMIN", is_admin=True)

    login_as(client, admin)
    response = client.get("/api/auth/me")

    assert response.status_code == 200
    assert response.json() == {
        "authenticated": True,
        "user_id": str(admin.id),
        "display_name": admin.display_name,
        "is_admin": True,
    }


def test_create_track_defaults_to_unpublished(client, session):
    owner = create_user(session, "OWNER")
    login_as(client, owner)

    response = client.post(
        "/api/tracks",
        json={"name": "Draft", "track_payload_json": {"id": "draft"}},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["is_published"] is False
    created = session.get(Track, UUID(payload["id"]))
    assert created is not None
    assert created.is_published is False


def test_list_tracks_for_anonymous_user(client, session):
    owner = create_user(session, "OWNER")
    create_track(session, "System", source="system", is_published=True)
    create_track(session, "Published", owner=owner, is_published=True)
    create_track(session, "Draft", owner=owner, is_published=False)

    response = client.get("/api/tracks")

    assert response.status_code == 200
    payload = response.json()
    assert track_names(payload) == ["Published", "System"]
    assert isinstance(payload[0].get("track_payload_json"), dict)


def test_list_tracks_for_authenticated_non_admin_includes_own_drafts(client, session):
    owner = create_user(session, "OWNER")
    other = create_user(session, "OTHER")
    create_track(session, "Published", owner=other, is_published=True)
    create_track(session, "Own Draft", owner=owner, is_published=False)
    create_track(session, "Other Draft", owner=other, is_published=False)

    login_as(client, owner)
    response = client.get("/api/tracks")

    assert response.status_code == 200
    assert track_names(response.json()) == ["Own Draft", "Published"]


def test_list_tracks_for_admin_includes_all_tracks(client, session):
    admin = create_user(session, "ADMIN", is_admin=True)
    owner = create_user(session, "OWNER")
    create_track(session, "Published", owner=owner, is_published=True)
    create_track(session, "Draft", owner=owner, is_published=False)

    login_as(client, admin)
    response = client.get("/api/tracks")

    assert response.status_code == 200
    assert track_names(response.json()) == ["Draft", "Published"]


def test_unpublished_track_visible_to_owner_but_not_other_user(client, session):
    owner = create_user(session, "OWNER")
    other = create_user(session, "OTHER")
    draft = create_track(
        session,
        "Draft",
        owner=owner,
        is_published=False,
        share_token="share-draft",
    )

    login_as(client, owner)
    owner_response = client.get(f"/api/tracks/{draft.id}")
    assert owner_response.status_code == 200

    login_as(client, other)
    other_response = client.get(f"/api/tracks/{draft.id}")
    assert other_response.status_code == 404


def test_unpublished_track_visible_to_admin(client, session):
    admin = create_user(session, "ADMIN", is_admin=True)
    owner = create_user(session, "OWNER")
    draft = create_track(session, "Draft", owner=owner, is_published=False)

    login_as(client, admin)
    response = client.get(f"/api/tracks/{draft.id}")

    assert response.status_code == 200
    assert response.json()["id"] == str(draft.id)


def test_share_token_returns_unpublished_track(client, session):
    owner = create_user(session, "OWNER")
    draft = create_track(
        session,
        "Draft",
        owner=owner,
        is_published=False,
        share_token="shared-token",
    )

    response = client.get("/api/tracks/share/shared-token")

    assert response.status_code == 200
    assert response.json()["id"] == str(draft.id)


def test_publish_endpoint_requires_admin(client, session):
    owner = create_user(session, "OWNER")
    draft = create_track(session, "Draft", owner=owner, is_published=False)

    login_as(client, owner)
    response = client.patch(f"/api/tracks/{draft.id}/publish", json={"is_published": True})

    assert response.status_code == 403


def test_admin_can_toggle_publish_state(client, session):
    admin = create_user(session, "ADMIN", is_admin=True)
    owner = create_user(session, "OWNER")
    draft = create_track(session, "Draft", owner=owner, is_published=False)

    login_as(client, admin)
    response = client.patch(f"/api/tracks/{draft.id}/publish", json={"is_published": True})

    assert response.status_code == 200
    assert response.json()["is_published"] is True
    session.refresh(draft)
    assert draft.is_published is True


def test_published_tracks_cannot_be_deleted(client, session):
    owner = create_user(session, "OWNER")
    published = create_track(session, "Published", owner=owner, is_published=True)

    login_as(client, owner)
    response = client.delete(f"/api/tracks/{published.id}")

    assert response.status_code == 409
    assert response.json()["detail"] == "Published tracks cannot be deleted"


def test_leaderboard_hides_unpublished_tracks_from_non_owner(client, session):
    owner = create_user(session, "OWNER")
    other = create_user(session, "OTHER")
    draft = create_track(session, "Draft", owner=owner, is_published=False)
    lap = BestLap(user_id=owner.id, track_id=draft.id, lap_ms=12000, build_version="test")
    session.add(lap)
    session.commit()

    login_as(client, other)
    response = client.get(f"/api/leaderboard/{draft.id}")

    assert response.status_code == 404


def test_leaderboard_visible_to_admin_for_unpublished_track(client, session):
    admin = create_user(session, "ADMIN", is_admin=True)
    owner = create_user(session, "OWNER")
    draft = create_track(session, "Draft", owner=owner, is_published=False)
    lap = BestLap(user_id=owner.id, track_id=draft.id, lap_ms=12000, build_version="test")
    session.add(lap)
    session.commit()

    login_as(client, admin)
    response = client.get(f"/api/leaderboard/{draft.id}")

    assert response.status_code == 200
    assert response.json()["entries"][0]["display_name"] == owner.display_name


def test_list_tracks_includes_owner_and_best_lap_metadata(client, session):
    owner = create_user(session, "OWNER")
    track = create_track(session, "Published", owner=owner, is_published=True)
    session.add(BestLap(user_id=owner.id, track_id=track.id, lap_ms=11111, build_version="test"))
    session.add(BestRace(user_id=owner.id, track_id=track.id, race_ms=33333, build_version="test"))
    session.commit()

    response = client.get("/api/tracks")

    assert response.status_code == 200
    row = next((item for item in response.json() if item["id"] == str(track.id)), None)
    assert row is not None
    assert row["owner_display_name"] == owner.display_name
    assert row["best_lap_ms"] == 11111
    assert row["best_lap_display_name"] == owner.display_name
    assert row["best_race_ms"] == 33333
    assert row["best_race_display_name"] == owner.display_name


def test_owner_can_rename_own_track(client, session):
    owner = create_user(session, "OWNER")
    track = create_track(session, "Old Name", owner=owner, is_published=False)
    login_as(client, owner)

    response = client.patch(f"/api/tracks/{track.id}", json={"name": "New Name"})

    assert response.status_code == 200
    assert response.json()["name"] == "New Name"
    session.refresh(track)
    assert track.name == "New Name"


def test_admin_can_rename_any_track(client, session):
    admin = create_user(session, "ADMIN", is_admin=True)
    owner = create_user(session, "OWNER")
    track = create_track(session, "Old Name", owner=owner, is_published=False)
    login_as(client, admin)

    response = client.patch(f"/api/tracks/{track.id}", json={"name": "Admin Rename"})

    assert response.status_code == 200
    assert response.json()["name"] == "Admin Rename"


def test_non_owner_non_admin_cannot_rename_track(client, session):
    owner = create_user(session, "OWNER")
    other = create_user(session, "OTHER")
    track = create_track(session, "Old Name", owner=owner, is_published=False)
    login_as(client, other)

    response = client.patch(f"/api/tracks/{track.id}", json={"name": "Nope"})

    assert response.status_code == 403


def test_submit_race_requires_auth(client, session):
    owner = create_user(session, "OWNER")
    track = create_track(session, "Track", owner=owner, is_published=True)
    logout(client)

    response = client.post(
        "/api/races",
        json={
            "track_id": str(track.id),
            "race_ms": 45000,
            "lap_count": 3,
            "completed": True,
            "build_version": "test",
        },
    )
    assert response.status_code == 401


def test_submit_race_upserts_best_race(client, session):
    owner = create_user(session, "OWNER")
    track = create_track(session, "Track", owner=owner, is_published=True)
    login_as(client, owner)

    first = client.post(
        "/api/races",
        json={
            "track_id": str(track.id),
            "race_ms": 52000,
            "lap_count": 3,
            "completed": True,
            "build_version": "test",
        },
    )
    second = client.post(
        "/api/races",
        json={
            "track_id": str(track.id),
            "race_ms": 50000,
            "lap_count": 3,
            "completed": True,
            "build_version": "test",
        },
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["best_race_ms"] == 52000
    assert second.json()["best_race_ms"] == 50000

    stored = session.exec(
        select(BestRace).where(BestRace.user_id == owner.id, BestRace.track_id == track.id)
    ).first()
    assert stored is not None
    assert stored.race_ms == 50000
