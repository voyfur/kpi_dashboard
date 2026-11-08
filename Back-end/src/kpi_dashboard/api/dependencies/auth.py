from __future__ import annotations

from urllib.parse import urlsplit

from fastapi import Depends, Request

from kpi_dashboard.api.errors import ApiError
from kpi_dashboard.app import KPI_SESSION_COOKIE
from kpi_dashboard.auth import AuthServiceUnavailable


def require_identity(request: Request) -> dict:
    token = request.cookies.get(KPI_SESSION_COOKIE)
    if not token:
        raise ApiError(401, "unauthorized")
    try:
        identity = request.app.state.auth_provider.resolve(token)
    except AuthServiceUnavailable:
        raise ApiError(503, "auth_unavailable") from None
    if identity is None:
        raise ApiError(401, "unauthorized")
    return identity


def require_admin(identity: dict = Depends(require_identity)) -> dict:
    if not identity.get("isAdmin", False):
        raise ApiError(403, "forbidden")
    return identity


def require_same_origin_json(request: Request) -> None:
    expected = _origin_key(request.app.state.settings.kpi_public_url)
    supplied = _origin_key(request.headers.get("origin", ""))
    if expected is None or supplied is None or supplied != expected:
        raise ApiError(403, "csrf_rejected")

    fetch_site = request.headers.get("sec-fetch-site")
    if fetch_site is not None and fetch_site.strip().casefold() not in {
        "same-origin",
        "same-site",
        "none",
    }:
        raise ApiError(403, "csrf_rejected")

    content_type = request.headers.get("content-type", "")
    media_type = content_type.split(";", maxsplit=1)[0].strip().casefold()
    if media_type != "application/json":
        raise ApiError(415, "invalid_request")


def _origin_key(value: str) -> tuple[str, str, int | None] | None:
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError:
        return None
    if (
        parsed.scheme.casefold() not in {"http", "https"}
        or not parsed.netloc
        or not hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path
        or parsed.query
        or parsed.fragment
    ):
        return None
    scheme = parsed.scheme.casefold()
    hostname = hostname.casefold()
    default_port = 443 if scheme == "https" else 80
    return scheme, hostname, None if port == default_port else port
