from uuid import uuid4

from app.auth_utils import build_unique_display_name, sanitize_display_name, upsert_user_from_google
from app.deps import get_current_user
from app.models import User


def create_user(session, *, display_name: str, google_sub: str | None = None) -> User:
    user = User(
        display_name=display_name,
        google_sub=google_sub or f"google-{uuid4()}",
        email="test@example.com",
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def test_sanitize_display_name_matches_product_rules():
    assert sanitize_display_name(" john-doe_123 ") == "JOHNDOE123"
    assert sanitize_display_name("   ") == "PLAYER"
    assert sanitize_display_name("averyveryverylongname") == "AVERYVERYVER"


def test_build_unique_display_name_appends_progressive_suffix(session):
    create_user(session, display_name="PLAYER", google_sub="sub-1")
    create_user(session, display_name="PLAYER2", google_sub="sub-2")

    assert build_unique_display_name(session, "player") == "PLAYER3"


def test_upsert_user_from_google_preserves_existing_custom_name(session):
    user = create_user(session, display_name="CUSTOMNAME", google_sub="google-fixed")

    updated = upsert_user_from_google(
        session,
        {"sub": "google-fixed", "name": "Google Name", "email": "new-email@example.com"},
    )
    assert updated.id == user.id
    assert updated.display_name == "CUSTOMNAME"
    assert updated.email == "new-email@example.com"


def test_upsert_user_from_google_assigns_unique_name_for_new_user(session):
    create_user(session, display_name="CARUNPLAYER", google_sub="already-present")

    created = upsert_user_from_google(
        session,
        {"sub": "new-sub", "name": "Carun Player", "email": "new@example.com"},
    )
    assert created.display_name == "CARUN PLAYER"


def test_patch_display_name_requires_auth(client):
    response = client.patch("/api/auth/display-name", json={"display_name": "newname"})
    assert response.status_code == 401


def test_patch_display_name_updates_current_user_and_session(client, session):
    current_user = create_user(session, display_name="ALFA", google_sub="sub-alfa")
    session.expunge(current_user)

    app = client.app
    app.dependency_overrides[get_current_user] = lambda: current_user
    try:
        response = client.patch("/api/auth/display-name", json={"display_name": "bravo"})
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert response.status_code == 200
    payload = response.json()
    assert payload["authenticated"] is True
    assert payload["display_name"] == "BRAVO"

    refreshed = session.get(User, current_user.id)
    assert refreshed is not None
    assert refreshed.display_name == "BRAVO"


def test_patch_display_name_resolves_collision_with_suffix(client, session):
    create_user(session, display_name="RACER", google_sub="sub-racer-1")
    current_user = create_user(session, display_name="PILOT", google_sub="sub-racer-2")
    session.expunge(current_user)

    app = client.app
    app.dependency_overrides[get_current_user] = lambda: current_user
    try:
        response = client.patch("/api/auth/display-name", json={"display_name": "racer"})
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert response.status_code == 200
    assert response.json()["display_name"] == "RACER2"
