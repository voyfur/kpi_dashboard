from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from kpi_dashboard.app import create_app


IDENTITY = {
    "id": "e6a7a5be-9a2f-41f2-9d42-d39810f9608e",
    "email": "admin@example.com",
    "isAdmin": True,
    "pages": [],
}


class AuthStub:
    def __init__(self):
        self.revoked = None
        self.resolved = None

    def login(self, email, password):
        assert email == "admin@example.com"
        assert password == "test-password"
        return IDENTITY, "upstream-session-secret"

    def resolve(self, token):
        self.resolved = token
        return IDENTITY if token == "upstream-session-secret" else None

    def logout(self, token):
        self.revoked = token


@pytest.fixture

def client_and_auth():
    app = create_app()
    app.state.settings = SimpleNamespace(
        kpi_public_url="http://testserver",
        cookie_secure=False,
    )
    app.state.auth_provider = AuthStub()
    return TestClient(app), app.state.auth_provider


def test_login_sets_httponly_kpi_cookie_without_returning_session(client_and_auth):
    client, _ = client_and_auth

    response = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "test-password"},
        headers={"Origin": "http://testserver"},
    )

    assert response.status_code == 200
    assert response.json() == IDENTITY
    assert client.cookies.get("kpi_session") == "upstream-session-secret"
    assert "httponly" in response.headers["set-cookie"].lower()
    assert "upstream-session-secret" not in response.text


def test_me_resolves_current_upstream_session(client_and_auth):
    client, auth = client_and_auth
    client.cookies.set("kpi_session", "upstream-session-secret")

    response = client.get("/api/v1/auth/me")

    assert response.status_code == 200
    assert response.json() == IDENTITY
    assert auth.resolved == "upstream-session-secret"


def test_me_rejects_missing_or_revoked_upstream_session(client_and_auth):
    client, _ = client_and_auth

    response = client.get("/api/v1/auth/me")

    assert response.status_code == 401


def test_logout_revokes_upstream_session_and_clears_local_cookie(client_and_auth):
    client, auth = client_and_auth
    client.cookies.set("kpi_session", "upstream-session-secret")

    response = client.post("/api/v1/auth/logout", headers={"Origin": "http://testserver"})

    assert response.status_code == 204
    assert auth.revoked == "upstream-session-secret"
    assert "max-age=0" in response.headers["set-cookie"].lower()


def test_login_rejects_cross_origin_request(client_and_auth):
    client, _ = client_and_auth

    response = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "test-password"},
        headers={"Origin": "https://attacker.example"},
    )

    assert response.status_code == 403
