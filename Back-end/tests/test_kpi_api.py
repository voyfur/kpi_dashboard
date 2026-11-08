from datetime import date
import uuid

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from kpi_dashboard.app import create_app
from kpi_dashboard.models import Base


class AuthStub:
    def resolve(self, token):
        return {
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, token)),
            "email": f"{token}@example.invalid",
            "isAdmin": token == "admin",
            "pages": [],
        }


def _client(*, authenticated=True, kpi_factory="create"):
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    event.listen(
        engine,
        "connect",
        lambda connection, _record: connection.create_function(
            "btrim", 1, lambda value: value.strip() if value else value
        ),
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    app = create_app()
    app.state.kpi_session_factory = factory if kpi_factory == "create" else kpi_factory
    app.state.auth_provider = AuthStub()
    client = TestClient(app)
    if authenticated:
        client.cookies.set("kpi_session", "admin")
    client._kpi_engine = engine
    return client


def _mutate(client, method, path, **kwargs):
    return getattr(client, method)(
        path,
        headers={"Origin": "http://localhost:5173"},
        **kwargs,
    )


def _department(client, name):
    response = _mutate(client, "post", "/api/v1/kpi/departments", json={"name": name})
    assert response.status_code == 201
    return response.json()["departmentId"]


def _dashboard(client, department_id, name):
    response = _mutate(
        client,
        "post",
        f"/api/v1/kpi/departments/{department_id}/dashboards",
        json={"name": name},
    )
    assert response.status_code == 201
    return response.json()["dashboardId"]


def _definition(client, department_id, name, unit="count", cadence="week"):
    response = _mutate(
        client,
        "post",
        f"/api/v1/kpi/departments/{department_id}/definitions",
        json={"name": name, "unit": unit, "precision": 1, "cadence": cadence},
    )
    assert response.status_code == 201
    return response.json()["definitionId"]


def _series(client, definition_id, label):
    response = _mutate(
        client,
        "post",
        f"/api/v1/kpi/definitions/{definition_id}/series",
        json={"label": label},
    )
    assert response.status_code == 201
    return response.json()["seriesId"]


def test_kpi_workspace_persists_reused_series_values_and_layout():
    with _client() as client:
        department_id = _department(client, "Sales")
        dashboard_id = _dashboard(client, department_id, "Revenue")
        definition_id = _definition(client, department_id, "Revenue", unit="USD")
        actual_id = _series(client, definition_id, "Actual")
        plan_id = _series(client, definition_id, "Plan")
        widget = _mutate(
            client,
            "post",
            f"/api/v1/kpi/dashboards/{dashboard_id}/widgets",
            json={"title": "Revenue trend", "seriesIds": [actual_id, plan_id]},
        )
        assert widget.status_code == 201
        widget_id = widget.json()["widgetId"]

        point = _mutate(
            client,
            "put",
            f"/api/v1/kpi/series/{actual_id}/values/2026-10-31",
            json={"value": "0", "comment": "Confirmed", "expectedUpdatedAt": None},
        )
        assert point.status_code == 200
        assert point.json()["value"] == "0"

        updated = _mutate(
            client,
            "patch",
            f"/api/v1/kpi/widgets/{widget_id}",
            json={"gridWidth": 12, "sortOrder": 1},
        )
        assert updated.status_code == 200

        loaded = client.get(f"/api/v1/kpi/dashboards/{dashboard_id}")
        assert loaded.status_code == 200
        data = loaded.json()
        assert data["department"]["name"] == "Sales"
        assert data["widgets"][0]["gridWidth"] == 12
        actual = next(
            series for series in data["widgets"][0]["series"]
            if series["seriesId"] == actual_id
        )
        saved = next(point for point in actual["points"] if point["periodStart"] == "2026-10-31")
        assert (saved["value"], saved["comment"]) == ("0", "Confirmed")
        missing = next(
            point for series in data["widgets"][0]["series"] if series["seriesId"] == plan_id
            for point in series["points"] if point["periodStart"] == "2026-10-31"
        )
        assert missing["value"] is None
        assert loaded.headers["cache-control"] == "private, no-store"


def test_widget_requires_two_to_four_series_with_one_cadence():
    with _client() as client:
        department_id = _department(client, "Operations")
        dashboard_id = _dashboard(client, department_id, "Operations")
        weekly = _series(client, _definition(client, department_id, "Weekly"), "Current")
        monthly = _series(client, _definition(client, department_id, "Monthly", cadence="month"), "Current")
        other_ids = [
            _series(client, _definition(client, department_id, f"KPI {index}"), "Current")
            for index in range(4)
        ]

        mixed = _mutate(
            client,
            "post",
            f"/api/v1/kpi/dashboards/{dashboard_id}/widgets",
            json={"title": "Mixed", "seriesIds": [weekly, monthly]},
        )
        too_many = _mutate(
            client,
            "post",
            f"/api/v1/kpi/dashboards/{dashboard_id}/widgets",
            json={"title": "Too many", "seriesIds": [weekly, *other_ids]},
        )

    assert mixed.status_code == 409
    assert mixed.json() == {"error": {"code": "incompatible_series"}}
    assert too_many.status_code == 400


def test_widget_assigns_two_units_to_separate_axes():
    with _client() as client:
        department_id = _department(client, "Finance")
        dashboard_id = _dashboard(client, department_id, "Finance")
        revenue = _series(client, _definition(client, department_id, "Revenue", unit="USD"), "Actual")
        margin = _series(client, _definition(client, department_id, "Margin", unit="%"), "Actual")

        widget = _mutate(
            client,
            "post",
            f"/api/v1/kpi/dashboards/{dashboard_id}/widgets",
            json={"title": "Finance trend", "seriesIds": [revenue, margin]},
        )

    assert widget.status_code == 201
    assert [series["axisSide"] for series in widget.json()["series"]] == ["left", "right"]


def test_value_write_uses_optimistic_concurrency_and_same_origin():
    with _client() as client:
        department_id = _department(client, "Operations")
        definition_id = _definition(client, department_id, "Quality", unit="%", cadence="month")
        series_id = _series(client, definition_id, "Current")
        first = _mutate(
            client,
            "put",
            f"/api/v1/kpi/series/{series_id}/values/2026-11-01",
            json={"value": "98.5", "expectedUpdatedAt": None},
        )
        stale = _mutate(
            client,
            "put",
            f"/api/v1/kpi/series/{series_id}/values/2026-11-01",
            json={
                "value": "99",
                "expectedUpdatedAt": "2000-01-01T00:00:00Z",
            },
        )
        blocked = client.put(
            f"/api/v1/kpi/series/{series_id}/values/2026-12-01",
            json={"value": "1", "expectedUpdatedAt": None},
        )

    assert first.status_code == 200
    assert stale.status_code == 409
    assert stale.json() == {"error": {"code": "value_conflict"}}
    assert blocked.status_code == 403


def test_all_users_can_write_values_but_only_admins_can_change_structure():
    with _client() as client:
        department_id = _department(client, "Operations")
        dashboard_id = _dashboard(client, department_id, "Throughput")
        definition_id = _definition(client, department_id, "Throughput")
        actual_id = _series(client, definition_id, "Actual")
        plan_id = _series(client, definition_id, "Plan")
        widget_id = _mutate(
            client,
            "post",
            f"/api/v1/kpi/dashboards/{dashboard_id}/widgets",
            json={"title": "Throughput", "seriesIds": [actual_id, plan_id]},
        ).json()["widgetId"]
        client.cookies.set("kpi_session", "user")

        read = client.get("/api/v1/kpi/departments")
        forbidden = _mutate(
            client,
            "patch",
            f"/api/v1/kpi/dashboards/{dashboard_id}",
            json={"name": "Restricted"},
        )
        saved = _mutate(
            client,
            "put",
            f"/api/v1/kpi/series/{actual_id}/values/2026-10-31",
            json={"value": "14", "comment": "Shift total", "expectedUpdatedAt": None},
        )

    assert read.status_code == 200
    assert forbidden.status_code == 403
    assert saved.status_code == 200
    assert saved.json()["value"] == "14"


def test_kpi_routes_require_identity_and_configured_storage():
    with _client(authenticated=False) as anonymous:
        unauthorized = anonymous.get("/api/v1/kpi/departments")
    with _client(kpi_factory=None) as unconfigured:
        unavailable = unconfigured.get("/api/v1/kpi/departments")

    assert unauthorized.status_code == 401
    assert unavailable.status_code == 503
