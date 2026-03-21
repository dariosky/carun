from app.main import settings


def test_head_root_returns_index_headers(client):
    response = client.head("/")

    assert response.status_code == 200
    assert response.text == ""
    assert response.headers["cache-control"] == "no-cache, must-revalidate"
    assert response.headers["content-type"].startswith("text/html")


def test_head_index_html_returns_index_headers(client):
    response = client.head("/index.html")

    assert response.status_code == 200
    assert response.text == ""
    assert response.headers["cache-control"] == "no-cache, must-revalidate"
    assert response.headers["content-type"].startswith("text/html")


def test_head_tracks_returns_index_headers(client):
    response = client.head("/tracks")

    assert response.status_code == 200
    assert response.text == ""
    assert response.headers["cache-control"] == "no-cache, must-revalidate"
    assert response.headers["content-type"].startswith("text/html")


def test_head_settings_returns_index_headers(client):
    response = client.head("/settings")

    assert response.status_code == 200
    assert response.text == ""
    assert response.headers["cache-control"] == "no-cache, must-revalidate"
    assert response.headers["content-type"].startswith("text/html")


def test_head_track_edit_returns_index_headers(client):
    response = client.head("/tracks/edit/test-track")

    assert response.status_code == 200
    assert response.text == ""
    assert response.headers["cache-control"] == "no-cache, must-revalidate"
    assert response.headers["content-type"].startswith("text/html")


def test_head_track_race_returns_index_headers(client):
    response = client.head("/tracks/test-track")

    assert response.status_code == 200
    assert response.text == ""
    assert response.headers["cache-control"] == "no-cache, must-revalidate"
    assert response.headers["content-type"].startswith("text/html")


def test_head_tournament_room_returns_index_headers(client):
    response = client.head("/tournament/test-room")

    assert response.status_code == 200
    assert response.text == ""
    assert response.headers["cache-control"] == "no-cache, must-revalidate"
    assert response.headers["content-type"].startswith("text/html")


def test_head_privacy_returns_html_headers(client):
    response = client.head("/privacy")

    assert response.status_code == 200
    assert response.text == ""
    assert response.headers["cache-control"] == "no-cache, must-revalidate"
    assert response.headers["content-type"].startswith("text/html")


def test_head_terms_returns_html_headers(client):
    response = client.head("/terms")

    assert response.status_code == 200
    assert response.text == ""
    assert response.headers["cache-control"] == "no-cache, must-revalidate"
    assert response.headers["content-type"].startswith("text/html")


def test_get_privacy_injects_admin_email(client):
    response = client.get("/privacy")

    assert response.status_code == 200
    assert "__ADMIN_EMAIL__" not in response.text
    assert "mailto:" in response.text


def test_get_terms_injects_admin_email(client):
    response = client.get("/terms")

    assert response.status_code == 200
    assert "__ADMIN_EMAIL__" not in response.text
    assert "mailto:" in response.text


def test_get_root_injects_social_metadata_for_local_static_mount(client):
    response = client.get("/")

    assert response.status_code == 200
    assert '<meta property="og:url" content="http://testserver/" />' in response.text
    assert 'property="og:image"' in response.text
    assert 'content="http://testserver/assets/social.png"' in response.text
    assert 'name="twitter:image"' in response.text


def test_get_root_injects_social_metadata_for_prod_static_mount(engine):
    from app.db import get_session
    from app.main import create_app
    from fastapi.testclient import TestClient
    from sqlmodel import Session

    original_app_env = settings.app_env
    original_build_id = settings.frontend_build_id
    settings.app_env = "prod"
    settings.frontend_build_id = "build123"

    try:
        app = create_app()

        def _get_session_override():
            with Session(engine) as db_session:
                yield db_session

        app.dependency_overrides[get_session] = _get_session_override

        with TestClient(app, base_url="https://carun.dariosky.it") as prod_client:
            response = prod_client.get("/")

        assert response.status_code == 200
        assert '<meta property="og:url" content="https://carun.dariosky.it/" />' in response.text
        assert 'property="og:image"' in response.text
        assert 'name="twitter:image"' in response.text
        assert (
            'content="https://carun.dariosky.it/static/build123/assets/social.png"' in response.text
        )
    finally:
        settings.app_env = original_app_env
        settings.frontend_build_id = original_build_id
