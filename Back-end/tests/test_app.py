from fastapi.testclient import TestClient

from kpi_dashboard.app import create_app


def test_health_route_returns_service_identity():
    response = TestClient(create_app()).get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "kpi-dashboards"}
