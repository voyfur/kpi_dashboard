from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    def __init__(self, status_code: int, code: str):
        super().__init__(code)
        self.status_code = status_code
        self.code = code


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def handle_api_error(_request: Request, error: ApiError) -> JSONResponse:
        return JSONResponse(
            status_code=error.status_code,
            content={"error": {"code": error.code}},
        )

    @app.exception_handler(SQLAlchemyError)
    async def handle_database_error(_request: Request, _error: SQLAlchemyError) -> JSONResponse:
        return JSONResponse(
            status_code=503,
            content={"error": {"code": "database_unavailable"}},
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        _request: Request, _error: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=400,
            content={"error": {"code": "invalid_request"}},
        )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(
        _request: Request, error: StarletteHTTPException
    ) -> JSONResponse:
        detail_codes = {
            "invalid_credentials",
            "unauthorized",
            "forbidden",
            "csrf_rejected",
            "auth_unavailable",
            "rate_limited",
        }
        if isinstance(error.detail, str) and error.detail in detail_codes:
            code = error.detail
        elif error.status_code == 404:
            code = "not_found"
        elif error.status_code == 401:
            code = "unauthorized"
        elif error.status_code == 403:
            code = "forbidden"
        else:
            code = "invalid_request"
        return JSONResponse(
            status_code=error.status_code,
            content={"error": {"code": code}},
        )
