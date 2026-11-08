from __future__ import annotations

from dataclasses import dataclass
import os


@dataclass(frozen=True, slots=True)
class Settings:
    app_env: str
    kpi_public_url: str
    dashboard_auth_api_url: str | None
    dashboard_public_url: str | None
    kpi_database_url: str | None

    @property
    def cookie_secure(self) -> bool:
        return self.app_env == "production"


def load_settings() -> Settings:
    return Settings(
        app_env=os.getenv("KPI_ENV", "development"),
        kpi_public_url=os.getenv("KPI_PUBLIC_URL", "http://localhost:5173").rstrip("/"),
        dashboard_auth_api_url=os.getenv("DASHBOARD_AUTH_API_URL"),
        dashboard_public_url=os.getenv("DASHBOARD_PUBLIC_URL"),
        kpi_database_url=os.getenv("KPI_DATABASE_URL"),
    )
