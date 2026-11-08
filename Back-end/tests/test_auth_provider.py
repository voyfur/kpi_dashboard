import httpx2

from kpi_dashboard.auth import DashboardAuthProvider


IDENTITY = {
    "id": "e6a7a5be-9a2f-41f2-9d42-d39810f9608e",
    "email": "admin@example.com",
    "isAdmin": True,
    "pages": [],
}


def test_dashboard_auth_provider_forwards_and_revokes_company_session():
    calls = []

    def handle(request):
        calls.append(request)
        if request.url.path.endswith("/login"):
            return httpx2.Response(
                200,
                json=IDENTITY,
                headers={"Set-Cookie": "dashboard_session=upstream-secret; Path=/; HttpOnly"},
            )
        if request.url.path.endswith("/me"):
            assert request.headers["cookie"] == "dashboard_session=upstream-secret"
            return httpx2.Response(200, json=IDENTITY)
        assert request.url.path.endswith("/logout")
        assert request.headers["cookie"] == "dashboard_session=upstream-secret"
        assert request.headers["origin"] == "https://dashboard.example"
        return httpx2.Response(204)

    transport = httpx2.MockTransport(handle)
    client = httpx2.Client(transport=transport)
    provider = DashboardAuthProvider(
        "http://dashboard.internal",
        "https://dashboard.example/console",
        client=client,
    )

    identity, token = provider.login("admin@example.com", "test-password")
    resolved = provider.resolve(token)
    provider.logout(token)

    assert identity == IDENTITY
    assert token == "upstream-secret"
    assert resolved == IDENTITY
    assert [call.url.path for call in calls] == [
        "/api/v1/auth/login",
        "/api/v1/auth/me",
        "/api/v1/auth/logout",
    ]
    assert calls[0].headers["origin"] == "https://dashboard.example"
    assert calls[0].read().decode() == '{"email":"admin@example.com","password":"test-password"}'

    client.close()
