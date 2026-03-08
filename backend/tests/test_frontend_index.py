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
