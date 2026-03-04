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
