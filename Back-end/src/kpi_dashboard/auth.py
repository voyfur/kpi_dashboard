from __future__ import annotations

import secrets
from typing import Any
from urllib.parse import urlsplit

import httpx2 as httpx


DASHBOARD_SESSION_COOKIE = "dashboard_session"


class AuthServiceUnavailable(RuntimeError):
    """The corporate authentication API could not complete a request."""


class AuthRateLimited(RuntimeError):
    """The corporate authentication API rate-limited a login attempt."""


class DashboardAuthProvider:
    """Validate and revoke company sessions through the Dashboard auth API."""

    def __init__(
        self,
        api_url: str,
        public_url: str,
        *,
        client: httpx.Client | None = None,
    ) -> None:
        self._api_url = api_url.rstrip("/")
        self._public_url = _origin_url(public_url)
        self._client = client or httpx.Client(timeout=5.0, follow_redirects=False)
        self._owns_client = client is None

    def login(self, email: str, password: str) -> tuple[dict[str, Any], str] | None:
        try:
            response = self._client.post(
                f"{self._api_url}/api/v1/auth/login",
                json={"email": email, "password": password},
                headers={"Origin": self._public_url},
            )
        except httpx.HTTPError as exc:
            raise AuthServiceUnavailable("corporate auth API request failed") from exc

        if response.status_code == 401:
            return None
        if response.status_code == 429:
            raise AuthRateLimited("corporate auth API rate-limited the login")
        if response.status_code != 200:
            raise AuthServiceUnavailable("corporate auth API rejected the request")

        token = response.cookies.get(DASHBOARD_SESSION_COOKIE)
        identity = _read_identity(response)
        if not token:
            raise AuthServiceUnavailable("corporate auth API omitted its session cookie")
        return identity, token

    def resolve(self, token: str) -> dict[str, Any] | None:
        try:
            response = self._client.get(
                f"{self._api_url}/api/v1/auth/me",
                headers={"Cookie": f"{DASHBOARD_SESSION_COOKIE}={token}"},
            )
        except httpx.HTTPError as exc:
            raise AuthServiceUnavailable("corporate auth API request failed") from exc

        if response.status_code == 401:
            return None
        if response.status_code != 200:
            raise AuthServiceUnavailable("corporate auth API rejected the request")
        return _read_identity(response)

    def logout(self, token: str) -> None:
        try:
            response = self._client.post(
                f"{self._api_url}/api/v1/auth/logout",
                headers={
                    "Cookie": f"{DASHBOARD_SESSION_COOKIE}={token}",
                    "Origin": self._public_url,
                    "Content-Type": "application/json",
                },
                content="{}",
            )
        except httpx.HTTPError as exc:
            raise AuthServiceUnavailable("corporate auth API request failed") from exc
        if response.status_code != 204:
            raise AuthServiceUnavailable("corporate auth API rejected logout")

    def close(self) -> None:
        if self._owns_client:
            self._client.close()


class UnavailableAuthProvider:
    def login(self, email: str, password: str) -> None:
        raise AuthServiceUnavailable("corporate auth API is not configured")

    def resolve(self, token: str) -> None:
        raise AuthServiceUnavailable("corporate auth API is not configured")

    def logout(self, token: str) -> None:
        raise AuthServiceUnavailable("corporate auth API is not configured")


class LocalDevelopmentAuthProvider:
    """Local-only admin sign-in for disposable development environments."""

    def __init__(self, email: str, password: str) -> None:
        self._email = email.strip()
        self._password = password
        self._identity = {
            "id": "local-development-admin",
            "email": self._email,
            "isAdmin": True,
            "pages": [],
        }
        self._active_tokens: set[str] = set()

    def login(self, email: str, password: str) -> tuple[dict[str, Any], str] | None:
        email_matches = secrets.compare_digest(
            email.strip().casefold().encode(),
            self._email.casefold().encode(),
        )
        password_matches = secrets.compare_digest(password.encode(), self._password.encode())
        if not email_matches or not password_matches:
            return None

        token = secrets.token_urlsafe(32)
        self._active_tokens.add(token)
        return self._identity.copy(), token

    def resolve(self, token: str) -> dict[str, Any] | None:
        return self._identity.copy() if token in self._active_tokens else None

    def logout(self, token: str) -> None:
        self._active_tokens.discard(token)


def _read_identity(response: httpx.Response) -> dict[str, Any]:
    try:
        identity = response.json()
    except ValueError as exc:
        raise AuthServiceUnavailable("corporate auth API returned invalid JSON") from exc
    if (
        not isinstance(identity, dict)
        or not isinstance(identity.get("id"), str)
        or not isinstance(identity.get("email"), str)
        or not isinstance(identity.get("isAdmin"), bool)
    ):
        raise AuthServiceUnavailable("corporate auth API returned invalid identity")
    pages = identity.get("pages", [])
    if not isinstance(pages, list) or any(not isinstance(page, str) for page in pages):
        raise AuthServiceUnavailable("corporate auth API returned invalid identity")
    return {
        "id": identity["id"],
        "email": identity["email"],
        "isAdmin": identity["isAdmin"],
        "pages": pages,
    }


def _origin_url(value: str) -> str:
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
        _ = parsed.port
    except ValueError as exc:
        raise ValueError("dashboard public URL is invalid") from exc
    if (
        parsed.scheme.casefold() not in {"http", "https"}
        or not parsed.netloc
        or not hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("dashboard public URL is invalid")
    return f"{parsed.scheme.casefold()}://{parsed.netloc}"
