from __future__ import annotations

from collections.abc import Callable
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session, sessionmaker

from kpi_dashboard.api.errors import install_error_handlers
from kpi_dashboard.auth import (
    AuthRateLimited,
    AuthServiceUnavailable,
    DashboardAuthProvider,
    LocalDevelopmentAuthProvider,
    UnavailableAuthProvider,
)
from kpi_dashboard.config import Settings, load_settings
from kpi_dashboard.db import create_engine_for_url, create_session_factory


KPI_SESSION_COOKIE = "kpi_session"
_COOKIE_MAX_AGE = 10 * 365 * 24 * 60 * 60


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=1, max_length=1024)
    password: str = Field(min_length=1, max_length=1024)


def create_app(
    settings: Settings | None = None,
    auth_provider: Any | None = None,
    kpi_session_factory: sessionmaker[Session] | Callable[[], Session] | None = None,
) -> FastAPI:
    process_settings = settings or load_settings()
    engine = None
    if kpi_session_factory is None and process_settings.kpi_database_url:
        engine = create_engine_for_url(process_settings.kpi_database_url)
        kpi_session_factory = create_session_factory(engine)

    if auth_provider is not None:
        process_auth_provider = auth_provider
    elif process_settings.dev_auth_email is not None or process_settings.dev_auth_password is not None:
        if process_settings.app_env != "development":
            raise RuntimeError("local development authentication is only available when KPI_ENV=development")
        if not process_settings.dev_auth_email or not process_settings.dev_auth_password:
            raise RuntimeError("KPI_DEV_AUTH_EMAIL and KPI_DEV_AUTH_PASSWORD must both be configured")
        process_auth_provider = LocalDevelopmentAuthProvider(
            process_settings.dev_auth_email,
            process_settings.dev_auth_password,
        )
    elif process_settings.dashboard_auth_api_url and process_settings.dashboard_public_url:
        process_auth_provider = DashboardAuthProvider(
            process_settings.dashboard_auth_api_url,
            process_settings.dashboard_public_url,
        )
    else:
        process_auth_provider = UnavailableAuthProvider()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        try:
            yield
        finally:
            if engine is not None:
                engine.dispose()
            close = getattr(process_auth_provider, "close", None)
            if callable(close):
                close()

    app = FastAPI(title="KPI Dashboards API", lifespan=lifespan)
    app.state.settings = process_settings
    app.state.auth_provider = process_auth_provider
    app.state.kpi_session_factory = kpi_session_factory
    install_error_handlers(app)

    @app.get("/healthz", include_in_schema=False)
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "kpi-dashboards"}

    @app.post("/api/v1/auth/login")
    def login(payload: LoginRequest, request: Request, response: Response) -> dict[str, Any]:
        _require_same_origin(request)
        try:
            result = request.app.state.auth_provider.login(payload.email, payload.password)
        except AuthRateLimited:
            raise HTTPException(status_code=429, detail="rate_limited") from None
        except AuthServiceUnavailable:
            raise HTTPException(status_code=503, detail="auth_unavailable") from None
        if result is None:
            raise HTTPException(status_code=401, detail="invalid_credentials")

        identity, upstream_token = result
        response.set_cookie(
            key=KPI_SESSION_COOKIE,
            value=upstream_token,
            max_age=_COOKIE_MAX_AGE,
            path="/",
            secure=request.app.state.settings.cookie_secure,
            httponly=True,
            samesite="lax",
        )
        return identity

    @app.get("/api/v1/auth/me")
    def me(request: Request) -> dict[str, Any]:
        token = request.cookies.get(KPI_SESSION_COOKIE)
        if not token:
            raise HTTPException(status_code=401, detail="unauthorized")
        try:
            identity = request.app.state.auth_provider.resolve(token)
        except AuthServiceUnavailable:
            raise HTTPException(status_code=503, detail="auth_unavailable") from None
        if identity is None:
            raise HTTPException(status_code=401, detail="unauthorized")
        return identity

    @app.post("/api/v1/auth/logout", response_class=Response)
    def logout(request: Request, response: Response) -> Response:
        _require_same_origin(request)
        token = request.cookies.get(KPI_SESSION_COOKIE)
        if token:
            try:
                request.app.state.auth_provider.logout(token)
            except AuthServiceUnavailable:
                response.delete_cookie(
                    key=KPI_SESSION_COOKIE,
                    path="/",
                    secure=request.app.state.settings.cookie_secure,
                    httponly=True,
                    samesite="lax",
                )
                response.status_code = 503
                return response
        response.delete_cookie(
            key=KPI_SESSION_COOKIE,
            path="/",
            secure=request.app.state.settings.cookie_secure,
            httponly=True,
            samesite="lax",
        )
        response.status_code = 204
        return response

    from kpi_dashboard.api.routes.kpi import router as kpi_router

    app.include_router(kpi_router)

    @app.middleware("http")
    async def private_api_cache(request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith(("/api/v1/auth", "/api/v1/kpi")):
            response.headers["Cache-Control"] = "private, no-store"
        return response

    return app


def _require_same_origin(request: Request) -> None:
    expected_origin = request.app.state.settings.kpi_public_url
    supplied_origin = request.headers.get("origin", "").rstrip("/")
    fetch_site = request.headers.get("sec-fetch-site", "").casefold()
    if supplied_origin != expected_origin or fetch_site == "cross-site":
        raise HTTPException(status_code=403, detail="csrf_rejected")


app = create_app()
