"""Authenticated shared workspace for KPI dashboards and period values."""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any
import uuid

from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from kpi_dashboard.api.dependencies.auth import require_admin, require_identity, require_same_origin_json
from kpi_dashboard.api.errors import ApiError
from kpi_dashboard.models import (
    KpiDashboard,
    KpiDashboardWidget,
    KpiDepartment,
    KpiDefinition,
    KpiSeries,
    KpiValue,
    KpiWidgetSeries,
)
from kpi_dashboard.schemas.kpi import (
    CreateDashboardRequest,
    CreateDefinitionRequest,
    CreateDepartmentRequest,
    DeleteDepartmentRequest,
    CreateSeriesRequest,
    CreateWidgetRequest,
    DashboardDetailView,
    DashboardListView,
    DeleteValueRequest,
    DefinitionView,
    DepartmentView,
    UpdateDashboardRequest,
    UpdateDepartmentRequest,
    UpdateDefinitionRequest,
    UpdateSeriesRequest,
    UpdateWidgetRequest,
    ValuePointView,
    WidgetSeriesView,
    WidgetView,
    WriteValueRequest,
)
from kpi_dashboard.periods import (
    Cadence,
    PeriodStart,
    current_period_start,
    intersecting_period_starts,
    last_period_starts,
    period_start_for,
    storage_period_start,
)


router = APIRouter(prefix="/api/v1/kpi", tags=["kpi"])


def _factory(request: Request):
    factory = getattr(request.app.state, "kpi_session_factory", None)
    if factory is None:
        raise ApiError(503, "kpi_storage_unavailable")
    return factory


def _required(session: Session, model: type, key: uuid.UUID, field: str):
    item = session.get(model, key)
    if item is None:
        raise ApiError(404, "not_found")
    return item


def _clean_optional_text(value: str | None) -> str | None:
    cleaned = value.strip() if value is not None else ""
    return cleaned or None


@router.get("/departments", response_model=list[dict[str, Any]])
def list_departments(
    request: Request,
    _identity=Depends(require_identity),
) -> list[dict[str, Any]]:
    with _factory(request)() as session:
        departments = session.scalars(
            select(KpiDepartment).order_by(KpiDepartment.sort_order, KpiDepartment.name)
        ).all()
        dashboards = session.scalars(
            select(KpiDashboard).order_by(KpiDashboard.sort_order, KpiDashboard.name)
        ).all()
    dashboards_by_department: dict[uuid.UUID, list[DashboardListView]] = {}
    for dashboard in dashboards:
        dashboards_by_department.setdefault(dashboard.department_id, []).append(
            DashboardListView(
                dashboardId=dashboard.dashboard_id,
                departmentId=dashboard.department_id,
                name=dashboard.name,
                description=dashboard.description,
                sortOrder=dashboard.sort_order,
            )
        )
    return [
        {
            **DepartmentView(
                departmentId=department.department_id,
                name=department.name,
                emoji=department.emoji,
                color=department.color,
                sortOrder=department.sort_order,
                parentDepartmentId=department.parent_department_id,
            ).model_dump(by_alias=True),
            "dashboards": [
                dashboard.model_dump(by_alias=True)
                for dashboard in dashboards_by_department.get(department.department_id, [])
            ],
        }
        for department in departments
    ]


@router.post(
    "/departments",
    response_model=DepartmentView,
    status_code=status.HTTP_201_CREATED,
)
def create_department(
    payload: CreateDepartmentRequest,
    request: Request,
    _admin=Depends(require_admin),
    _csrf: None = Depends(require_same_origin_json),
) -> DepartmentView:
    if not payload.name:
        raise ApiError(400, "invalid_request")
    with _factory(request)() as session, session.begin():
        if payload.parent_department_id is not None:
            _required(session, KpiDepartment, payload.parent_department_id, "parent_department_id")
        department = KpiDepartment(
            name=payload.name,
            emoji=payload.emoji,
            color=payload.color,
            parent_department_id=payload.parent_department_id,
            sort_order=payload.sort_order,
        )
        session.add(department)
        session.flush()
        result = DepartmentView(
            departmentId=department.department_id,
            name=department.name,
            emoji=department.emoji,
            color=department.color,
            sortOrder=department.sort_order,
            parentDepartmentId=department.parent_department_id,
        )
    return result


@router.patch("/departments/{department_id}", response_model=DepartmentView)
def update_department(
    department_id: uuid.UUID,
    payload: UpdateDepartmentRequest,
    request: Request,
    _admin=Depends(require_admin),
    _csrf: None = Depends(require_same_origin_json),
) -> DepartmentView:
    if not payload.model_fields_set:
        raise ApiError(400, "invalid_request")
    if "name" in payload.model_fields_set and not payload.name:
        raise ApiError(400, "invalid_request")
    with _factory(request)() as session, session.begin():
        department = _required(session, KpiDepartment, department_id, "department_id")
        if payload.parent_department_id is not None:
            parent = _required(session, KpiDepartment, payload.parent_department_id, "parent_department_id")
            visited: set[uuid.UUID] = set()
            while parent is not None:
                if parent.department_id == department_id:
                    raise ApiError(400, "invalid_department_parent")
                if parent.department_id in visited:
                    raise ApiError(409, "invalid_department_hierarchy")
                visited.add(parent.department_id)
                parent = session.get(KpiDepartment, parent.parent_department_id) if parent.parent_department_id else None
        if payload.name is not None:
            department.name = payload.name
        if "emoji" in payload.model_fields_set:
            department.emoji = payload.emoji
        if "color" in payload.model_fields_set:
            department.color = payload.color
        if payload.sort_order is not None:
            department.sort_order = payload.sort_order
        if "parent_department_id" in payload.model_fields_set:
            department.parent_department_id = payload.parent_department_id
        session.flush()
        result = DepartmentView(
            departmentId=department.department_id,
            name=department.name,
            emoji=department.emoji,
            color=department.color,
            sortOrder=department.sort_order,
            parentDepartmentId=department.parent_department_id,
        )
    return result


@router.delete("/departments/{department_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_department(
    department_id: uuid.UUID,
    payload: DeleteDepartmentRequest,
    request: Request,
    _admin=Depends(require_admin),
    _csrf: None = Depends(require_same_origin_json),
) -> Response:
    with _factory(request)() as session, session.begin():
        department = _required(session, KpiDepartment, department_id, "department_id")
        if payload.confirmation_name != department.name:
            raise ApiError(400, "department_name_mismatch")

        department_ids: list[uuid.UUID] = []
        pending = [department_id]
        seen: set[uuid.UUID] = set()
        while pending:
            current_id = pending.pop()
            if current_id in seen:
                continue
            seen.add(current_id)
            department_ids.append(current_id)
            pending.extend(session.scalars(
                select(KpiDepartment.department_id)
                .where(KpiDepartment.parent_department_id == current_id)
            ).all())

        dashboard_ids = session.scalars(
            select(KpiDashboard.dashboard_id)
            .where(KpiDashboard.department_id.in_(department_ids))
        ).all()
        widget_ids = session.scalars(
            select(KpiDashboardWidget.widget_id)
            .where(KpiDashboardWidget.dashboard_id.in_(dashboard_ids))
        ).all() if dashboard_ids else []
        definition_ids = session.scalars(
            select(KpiDefinition.definition_id)
            .where(KpiDefinition.department_id.in_(department_ids))
        ).all()
        series_ids = session.scalars(
            select(KpiSeries.series_id)
            .where(KpiSeries.definition_id.in_(definition_ids))
        ).all() if definition_ids else []

        if widget_ids:
            session.execute(delete(KpiWidgetSeries).where(KpiWidgetSeries.widget_id.in_(widget_ids)))
            session.execute(delete(KpiDashboardWidget).where(KpiDashboardWidget.widget_id.in_(widget_ids)))
        if dashboard_ids:
            session.execute(delete(KpiDashboard).where(KpiDashboard.dashboard_id.in_(dashboard_ids)))
        if series_ids:
            session.execute(delete(KpiValue).where(KpiValue.series_id.in_(series_ids)))
        if definition_ids:
            session.execute(delete(KpiSeries).where(KpiSeries.definition_id.in_(definition_ids)))
            session.execute(delete(KpiDefinition).where(KpiDefinition.definition_id.in_(definition_ids)))
        for item_id in reversed(department_ids):
            session.execute(delete(KpiDepartment).where(KpiDepartment.department_id == item_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/departments/{department_id}/definitions", response_model=list[DefinitionView])
def list_definitions(
    department_id: uuid.UUID,
    request: Request,
    _identity=Depends(require_identity),
) -> list[DefinitionView]:
    with _factory(request)() as session:
        _required(session, KpiDepartment, department_id, "department_id")
        definitions = session.scalars(
            select(KpiDefinition)
            .where(KpiDefinition.department_id == department_id)
            .order_by(KpiDefinition.name)
        ).all()
        series = session.scalars(
            select(KpiSeries)
            .join(KpiDefinition, KpiDefinition.definition_id == KpiSeries.definition_id)
            .where(KpiDefinition.department_id == department_id)
            .order_by(KpiSeries.label)
        ).all()
    by_definition: dict[uuid.UUID, list[dict[str, Any]]] = {}
    for item in series:
        by_definition.setdefault(item.definition_id, []).append(
            {"seriesId": str(item.series_id), "label": item.label}
        )
    return [
        DefinitionView(
            definitionId=item.definition_id,
            departmentId=item.department_id,
            name=item.name,
            description=item.description,
            unit=item.unit,
            precision=item.precision,
            cadence=item.cadence,
            series=by_definition.get(item.definition_id, []),
        )
        for item in definitions
    ]


@router.get(
    "/departments/{department_id}/series-preview",
    response_model=list[WidgetSeriesView],
)
def preview_series(
    department_id: uuid.UUID,
    request: Request,
    series_ids: list[uuid.UUID] = Query(alias="seriesIds"),
    period_count: int = Query(default=8, alias="periodCount", ge=4, le=60),
    _identity=Depends(require_identity),
) -> list[WidgetSeriesView]:
    allowed_period_counts = {4, 8, 12, 16, 24, 36, 52, 60}
    if not series_ids or len(series_ids) > 10 or len(set(series_ids)) != len(series_ids):
        raise ApiError(400, "invalid_request")
    if period_count not in allowed_period_counts:
        raise ApiError(400, "invalid_request")

    with _factory(request)() as session:
        _required(session, KpiDepartment, department_id, "department_id")
        joined = session.execute(
            select(KpiSeries, KpiDefinition)
            .join(KpiDefinition, KpiDefinition.definition_id == KpiSeries.definition_id)
            .where(
                KpiDefinition.department_id == department_id,
                KpiSeries.series_id.in_(series_ids),
            )
        ).all()
        by_series_id = {series.series_id: (series, definition) for series, definition in joined}
        if len(by_series_id) != len(series_ids):
            raise ApiError(404, "not_found")

        now = datetime.now(timezone.utc)
        periods_by_series = {
            series_id: last_period_starts(now, by_series_id[series_id][1].cadence, count=period_count)
            for series_id in series_ids
        }
        all_periods = {storage_period_start(period) for periods in periods_by_series.values() for period in periods}
        values = session.scalars(
            select(KpiValue).where(
                KpiValue.series_id.in_(series_ids),
                KpiValue.period_start.in_(all_periods),
            )
        ).all() if all_periods else []

    values_by_key = {(value.series_id, _aware(value.period_start)): value for value in values}
    sides_by_unit: dict[str, str] = {}
    next_side = "left"
    previews = []
    for series_id in series_ids:
        series, definition = by_series_id[series_id]
        if definition.unit not in sides_by_unit:
            sides_by_unit[definition.unit] = next_side
            next_side = "right"
        periods = periods_by_series[series_id]
        previews.append(
            WidgetSeriesView(
                seriesId=series.series_id,
                definitionId=definition.definition_id,
                name=definition.name,
                unit=definition.unit,
                precision=definition.precision,
                cadence=definition.cadence,
                label=series.label,
                axisSide=sides_by_unit[definition.unit],
                points=[
                    ValuePointView(
                        periodStart=period,
                        value=_decimal_text(value.numeric_value) if (value := values_by_key.get((series_id, storage_period_start(period)))) else None,
                        comment=value.comment if value else None,
                        updatedAt=_aware(value.updated_at) if value else None,
                        isCurrentPeriod=period == current_period_start(now, definition.cadence),
                    )
                    for period in periods
                ],
            )
        )
    return previews


@router.post(
    "/departments/{department_id}/definitions",
    response_model=DefinitionView,
    status_code=status.HTTP_201_CREATED,
)
def create_definition(
    department_id: uuid.UUID,
    payload: CreateDefinitionRequest,
    request: Request,
    _admin=Depends(require_admin),
    _csrf: None = Depends(require_same_origin_json),
) -> DefinitionView:
    if not payload.name or not payload.unit:
        raise ApiError(400, "invalid_request")
    with _factory(request)() as session, session.begin():
        _required(session, KpiDepartment, department_id, "department_id")
        definition = KpiDefinition(
            department_id=department_id,
            name=payload.name,
            description=_clean_optional_text(payload.description),
            unit=payload.unit,
            precision=payload.precision,
            cadence=payload.cadence,
        )
        session.add(definition)
        session.flush()
        created_series = [
            KpiSeries(definition_id=definition.definition_id, label=label)
            for label in payload.series_labels
        ]
        session.add_all(created_series)
        session.flush()
        result = DefinitionView(
            definitionId=definition.definition_id,
            departmentId=definition.department_id,
            name=definition.name,
            description=definition.description,
            unit=definition.unit,
            precision=definition.precision,
            cadence=definition.cadence,
            series=[
                {"seriesId": str(series.series_id), "label": series.label}
                for series in created_series
            ],
        )
    return result


@router.patch("/definitions/{definition_id}", response_model=DefinitionView)
def update_definition(
    definition_id: uuid.UUID,
    payload: UpdateDefinitionRequest,
    request: Request,
    _admin=Depends(require_admin),
    _csrf: None = Depends(require_same_origin_json),
) -> DefinitionView:
    if not payload.model_fields_set:
        raise ApiError(400, "invalid_request")
    for field in ("name", "unit", "precision", "cadence"):
        if field in payload.model_fields_set and getattr(payload, field) is None:
            raise ApiError(400, "invalid_request")
    if "name" in payload.model_fields_set and not payload.name:
        raise ApiError(400, "invalid_request")
    if "unit" in payload.model_fields_set and not payload.unit:
        raise ApiError(400, "invalid_request")

    with _factory(request)() as session, session.begin():
        definition = session.scalar(
            select(KpiDefinition)
            .where(KpiDefinition.definition_id == definition_id)
            .with_for_update()
        )
        if definition is None:
            raise ApiError(404, "not_found")
        meaning_changes = (
            (payload.unit is not None and payload.unit != definition.unit)
            or (payload.cadence is not None and payload.cadence != definition.cadence)
        )
        if meaning_changes:
            has_values = session.scalar(
                select(KpiValue.value_id)
                .join(KpiSeries, KpiSeries.series_id == KpiValue.series_id)
                .where(KpiSeries.definition_id == definition_id)
                .limit(1)
            ) is not None
            in_widget = session.scalar(
                select(KpiWidgetSeries.widget_id)
                .join(KpiSeries, KpiSeries.series_id == KpiWidgetSeries.series_id)
                .where(KpiSeries.definition_id == definition_id)
                .limit(1)
            ) is not None
            if has_values or in_widget:
                raise ApiError(409, "definition_in_use")
        if payload.name is not None:
            definition.name = payload.name
        if "description" in payload.model_fields_set:
            definition.description = _clean_optional_text(payload.description)
        if payload.unit is not None:
            definition.unit = payload.unit
        if payload.precision is not None:
            definition.precision = payload.precision
        if payload.cadence is not None:
            definition.cadence = payload.cadence
        series = session.scalars(
            select(KpiSeries)
            .where(KpiSeries.definition_id == definition_id)
            .order_by(KpiSeries.label)
        ).all()
        result = DefinitionView(
            definitionId=definition.definition_id,
            departmentId=definition.department_id,
            name=definition.name,
            description=definition.description,
            unit=definition.unit,
            precision=definition.precision,
            cadence=definition.cadence,
            series=[{"seriesId": str(item.series_id), "label": item.label} for item in series],
        )
    return result


@router.patch("/series/{series_id}")
def update_series(
    series_id: uuid.UUID,
    payload: UpdateSeriesRequest,
    request: Request,
    _admin=Depends(require_admin),
    _csrf: None = Depends(require_same_origin_json),
) -> dict[str, str]:
    if not payload.label:
        raise ApiError(400, "invalid_request")
    with _factory(request)() as session, session.begin():
        series = _required(session, KpiSeries, series_id, "series_id")
        series.label = payload.label
        result = {
            "seriesId": str(series.series_id),
            "definitionId": str(series.definition_id),
            "label": series.label,
        }
    return result


@router.post(
    "/definitions/{definition_id}/series",
    status_code=status.HTTP_201_CREATED,
)
def create_series(
    definition_id: uuid.UUID,
    payload: CreateSeriesRequest,
    request: Request,
    _admin=Depends(require_admin),
    _csrf: None = Depends(require_same_origin_json),
) -> dict[str, str]:
    if not payload.label:
        raise ApiError(400, "invalid_request")
    with _factory(request)() as session, session.begin():
        _required(session, KpiDefinition, definition_id, "definition_id")
        series = KpiSeries(definition_id=definition_id, label=payload.label)
        session.add(series)
        session.flush()
        result = {"seriesId": str(series.series_id), "definitionId": str(definition_id), "label": series.label}
    return result


@router.post(
    "/departments/{department_id}/dashboards",
    response_model=DashboardListView,
    status_code=status.HTTP_201_CREATED,
)
def create_dashboard(
    department_id: uuid.UUID,
    payload: CreateDashboardRequest,
    request: Request,
    _admin=Depends(require_admin),
    _csrf: None = Depends(require_same_origin_json),
) -> DashboardListView:
    if not payload.name:
        raise ApiError(400, "invalid_request")
    with _factory(request)() as session, session.begin():
        _required(session, KpiDepartment, department_id, "department_id")
        dashboard = KpiDashboard(
            department_id=department_id,
            name=payload.name,
            description=_clean_optional_text(payload.description),
            sort_order=payload.sort_order,
        )
        session.add(dashboard)
        session.flush()
        result = DashboardListView(
            dashboardId=dashboard.dashboard_id,
            departmentId=dashboard.department_id,
            name=dashboard.name,
            description=dashboard.description,
            sortOrder=dashboard.sort_order,
        )
    return result


@router.patch("/dashboards/{dashboard_id}")
def update_dashboard(
    dashboard_id: uuid.UUID,
    payload: UpdateDashboardRequest,
    request: Request,
    _admin=Depends(require_admin),
    _csrf: None = Depends(require_same_origin_json),
) -> dict[str, Any]:
    if not payload.model_fields_set:
        raise ApiError(400, "invalid_request")
    if payload.name is not None and not payload.name:
        raise ApiError(400, "invalid_request")
    with _factory(request)() as session, session.begin():
        dashboard = _required(session, KpiDashboard, dashboard_id, "dashboard_id")
        if "name" in payload.model_fields_set and payload.name is not None:
            dashboard.name = payload.name
        if "description" in payload.model_fields_set:
            dashboard.description = _clean_optional_text(payload.description)
        if payload.sort_order is not None:
            dashboard.sort_order = payload.sort_order
        if "range_start" in payload.model_fields_set:
            dashboard.range_start = payload.range_start
            dashboard.range_end = payload.range_end
        session.flush()
        result = _dashboard_header(dashboard)
    return result


@router.delete("/dashboards/{dashboard_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_dashboard(
    dashboard_id: uuid.UUID,
    request: Request,
    _admin=Depends(require_admin),
    _csrf: None = Depends(require_same_origin_json),
) -> Response:
    with _factory(request)() as session, session.begin():
        dashboard = _required(session, KpiDashboard, dashboard_id, "dashboard_id")
        widget_ids = session.scalars(
            select(KpiDashboardWidget.widget_id).where(
                KpiDashboardWidget.dashboard_id == dashboard_id
            )
        ).all()
        if widget_ids:
            session.execute(
                delete(KpiWidgetSeries).where(KpiWidgetSeries.widget_id.in_(widget_ids))
            )
            session.execute(
                delete(KpiDashboardWidget).where(
                    KpiDashboardWidget.dashboard_id == dashboard_id
                )
            )
        session.delete(dashboard)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/dashboards/{dashboard_id}", response_model=DashboardDetailView)
def get_dashboard(
    dashboard_id: uuid.UUID,
    request: Request,
    _identity=Depends(require_identity),
) -> DashboardDetailView:
    with _factory(request)() as session:
        dashboard = _required(session, KpiDashboard, dashboard_id, "dashboard_id")
        department = _required(session, KpiDepartment, dashboard.department_id, "department_id")
        widgets = session.scalars(
            select(KpiDashboardWidget)
            .where(KpiDashboardWidget.dashboard_id == dashboard_id)
            .order_by(KpiDashboardWidget.sort_order, KpiDashboardWidget.widget_id)
        ).all()
        widget_ids = [widget.widget_id for widget in widgets]
        links = session.scalars(
            select(KpiWidgetSeries)
            .where(KpiWidgetSeries.widget_id.in_(widget_ids))
            .order_by(KpiWidgetSeries.sort_order)
        ).all() if widget_ids else []
        series_ids = list(dict.fromkeys(link.series_id for link in links))
        joined_series = session.execute(
            select(KpiSeries, KpiDefinition)
            .join(KpiDefinition, KpiDefinition.definition_id == KpiSeries.definition_id)
            .where(KpiSeries.series_id.in_(series_ids))
        ).all() if series_ids else []
        series_with_definitions = {series.series_id: (series, definition) for series, definition in joined_series}
        now = datetime.now(timezone.utc)
        periods_by_widget: dict[uuid.UUID, list[PeriodStart]] = {}
        for widget in widgets:
            widget_links = [link for link in links if link.widget_id == widget.widget_id]
            if not widget_links:
                periods_by_widget[widget.widget_id] = []
                continue
            _series, definition = series_with_definitions[widget_links[0].series_id]
            cadence = definition.cadence
            periods_by_widget[widget.widget_id] = _dashboard_periods(
                dashboard, cadence, widget.period_count, now
            )
        all_periods = {storage_period_start(period) for periods in periods_by_widget.values() for period in periods}
        value_rows = session.scalars(
            select(KpiValue).where(
                KpiValue.series_id.in_(series_ids),
                KpiValue.period_start.in_(all_periods),
            )
        ).all() if series_ids and all_periods else []

    values = {(item.series_id, _aware(item.period_start)): item for item in value_rows}
    links_by_widget: dict[uuid.UUID, list[KpiWidgetSeries]] = {}
    for link in links:
        links_by_widget.setdefault(link.widget_id, []).append(link)
    widget_views = []
    for widget in widgets:
        widget_periods = periods_by_widget[widget.widget_id]
        series_views = []
        for link in links_by_widget.get(widget.widget_id, []):
            series, definition = series_with_definitions[link.series_id]
            points = []
            for period in widget_periods:
                value = values.get((series.series_id, storage_period_start(period)))
                points.append(
                    ValuePointView(
                        periodStart=period,
                        value=_decimal_text(value.numeric_value) if value else None,
                        comment=value.comment if value else None,
                        updatedAt=_aware(value.updated_at) if value else None,
                        isCurrentPeriod=period == current_period_start(now, definition.cadence),
                    )
                )
            series_views.append(
                WidgetSeriesView(
                    seriesId=series.series_id,
                    definitionId=definition.definition_id,
                    name=definition.name,
                    unit=definition.unit,
                    precision=definition.precision,
                    cadence=definition.cadence,
                    label=series.label,
                    axisSide=link.axis_side,
                    color=link.series_color,
                    points=points,
                )
            )
        widget_views.append(
            WidgetView(
                widgetId=widget.widget_id,
                dashboardId=widget.dashboard_id,
                title=widget.title,
                description=widget.description,
                sortOrder=widget.sort_order,
                gridX=widget.grid_x,
                gridY=widget.grid_y,
                gridWidth=widget.grid_width,
                gridHeight=widget.grid_height,
                periodCount=widget.period_count,
                showLinearTrend=widget.show_linear_trend,
                showMovingAverage=widget.show_moving_average,
                periods=widget_periods,
                series=series_views,
            )
        )
    return DashboardDetailView(
        **_dashboard_header(dashboard),
        department=DepartmentView(
            departmentId=department.department_id,
            name=department.name,
            sortOrder=department.sort_order,
            parentDepartmentId=department.parent_department_id,
        ),
        widgets=widget_views,
    )


@router.post(
    "/dashboards/{dashboard_id}/widgets",
    response_model=WidgetView,
    status_code=status.HTTP_201_CREATED,
)
def create_widget(
    dashboard_id: uuid.UUID,
    payload: CreateWidgetRequest,
    request: Request,
    _admin=Depends(require_admin),
    _csrf: None = Depends(require_same_origin_json),
) -> WidgetView:
    if not payload.title:
        raise ApiError(400, "invalid_request")
    with _factory(request)() as session, session.begin():
        dashboard = _required(session, KpiDashboard, dashboard_id, "dashboard_id")
        selected = _load_compatible_series(session, dashboard, payload.series_ids)
        sides = _axis_sides(selected, payload.series)
        widget = KpiDashboardWidget(
            dashboard_id=dashboard_id,
            title=payload.title,
            description=_clean_optional_text(payload.description),
            sort_order=_next_widget_order(session, dashboard_id),
            grid_x=payload.grid_x,
            grid_y=payload.grid_y,
            grid_width=payload.grid_width,
            grid_height=payload.grid_height,
            period_count=payload.period_count,
            show_linear_trend=payload.show_linear_trend,
            show_moving_average=payload.show_moving_average,
        )
        session.add(widget)
        session.flush()
        for order, (series, _definition) in enumerate(selected):
            session.add(
                KpiWidgetSeries(
                    widget_id=widget.widget_id,
                    series_id=series.series_id,
                    sort_order=order,
                    axis_side=sides[series.series_id],
                    series_color=(payload.series_colors or {}).get(series.series_id),
                )
            )
        session.flush()
        result = _widget_config_view(session, widget)
    return result


@router.patch("/widgets/{widget_id}", response_model=WidgetView)
def update_widget(
    widget_id: uuid.UUID,
    payload: UpdateWidgetRequest,
    request: Request,
    _admin=Depends(require_admin),
    _csrf: None = Depends(require_same_origin_json),
) -> WidgetView:
    if not payload.model_fields_set:
        raise ApiError(400, "invalid_request")
    with _factory(request)() as session, session.begin():
        widget = _required(session, KpiDashboardWidget, widget_id, "widget_id")
        dashboard = _required(session, KpiDashboard, widget.dashboard_id, "dashboard_id")
        if payload.title is not None:
            if not payload.title:
                raise ApiError(400, "invalid_request")
            widget.title = payload.title
        if "description" in payload.model_fields_set:
            widget.description = _clean_optional_text(payload.description)
        for field_name in (
            "sort_order", "grid_x", "grid_y", "grid_width", "grid_height", "period_count",
            "show_linear_trend", "show_moving_average",
        ):
            value = getattr(payload, field_name)
            if value is not None:
                setattr(widget, field_name, value)
        current_links = session.scalars(
            select(KpiWidgetSeries).where(KpiWidgetSeries.widget_id == widget_id)
        ).all()
        current_colors = {link.series_id: link.series_color for link in current_links}
        target_series_ids = set(payload.series_ids) if payload.series_ids is not None else set(current_colors)
        if payload.series_colors is not None and not set(payload.series_colors).issubset(target_series_ids):
            raise ApiError(400, "invalid_request")
        if payload.series_ids is not None:
            selected = _load_compatible_series(session, dashboard, payload.series_ids)
            sides = _axis_sides(selected, payload.series)
            colors_by_series = {**current_colors, **(payload.series_colors or {})}
            session.execute(delete(KpiWidgetSeries).where(KpiWidgetSeries.widget_id == widget_id))
            for order, (series, _definition) in enumerate(selected):
                session.add(
                    KpiWidgetSeries(
                        widget_id=widget_id,
                        series_id=series.series_id,
                        sort_order=order,
                        axis_side=sides[series.series_id],
                        series_color=colors_by_series.get(series.series_id),
                    )
                )
        elif payload.series_colors is not None:
            colors_by_series = payload.series_colors
            for link in current_links:
                if link.series_id in colors_by_series:
                    link.series_color = colors_by_series[link.series_id]
        session.flush()
        result = _widget_config_view(session, widget)
    return result


@router.delete("/widgets/{widget_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_widget(
    widget_id: uuid.UUID,
    request: Request,
    _admin=Depends(require_admin),
    _csrf: None = Depends(require_same_origin_json),
) -> Response:
    with _factory(request)() as session, session.begin():
        widget = _required(session, KpiDashboardWidget, widget_id, "widget_id")
        session.execute(delete(KpiWidgetSeries).where(KpiWidgetSeries.widget_id == widget_id))
        session.delete(widget)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/series/{series_id}/values/{period_start}")
def write_value(
    series_id: uuid.UUID,
    period_start: str,
    payload: WriteValueRequest,
    request: Request,
    _identity=Depends(require_identity),
    _csrf: None = Depends(require_same_origin_json),
) -> dict[str, Any]:
    with _factory(request)() as session, session.begin():
        series = session.scalar(
            select(KpiSeries).where(KpiSeries.series_id == series_id).with_for_update()
        )
        if series is None:
            raise ApiError(404, "not_found")
        definition = _required(session, KpiDefinition, series.definition_id, "definition_id")
        logical_period = _parse_period_start(period_start, definition.cadence)
        stored_period = storage_period_start(logical_period)
        quantum = Decimal(1).scaleb(-definition.precision)
        if payload.value.quantize(quantum) != payload.value:
            raise ApiError(400, "invalid_precision")
        value = session.scalar(
            select(KpiValue)
            .where(KpiValue.series_id == series_id, KpiValue.period_start == stored_period)
            .with_for_update()
        )
        if not _matches_expected(value.updated_at if value else None, payload.expected_updated_at):
            raise ApiError(409, "value_conflict")
        if value is None:
            value = KpiValue(series_id=series_id, period_start=stored_period, numeric_value=payload.value)
            session.add(value)
        value.numeric_value = payload.value
        value.comment = _clean_optional_text(payload.comment)
        value.updated_at = datetime.now(timezone.utc)
        session.flush()
        result = _value_response(value, definition.cadence)
    return result


@router.delete("/series/{series_id}/values/{period_start}")
def delete_value(
    series_id: uuid.UUID,
    period_start: str,
    payload: DeleteValueRequest,
    request: Request,
    _identity=Depends(require_identity),
    _csrf: None = Depends(require_same_origin_json),
) -> Response:
    with _factory(request)() as session, session.begin():
        series = session.scalar(
            select(KpiSeries).where(KpiSeries.series_id == series_id).with_for_update()
        )
        if series is None:
            raise ApiError(404, "not_found")
        definition = _required(session, KpiDefinition, series.definition_id, "definition_id")
        stored_period = storage_period_start(_parse_period_start(period_start, definition.cadence))
        value = session.scalar(
            select(KpiValue)
            .where(KpiValue.series_id == series_id, KpiValue.period_start == stored_period)
            .with_for_update()
        )
        if value is None or not _matches_expected(value.updated_at, payload.expected_updated_at):
            raise ApiError(409, "value_conflict")
        session.delete(value)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _load_compatible_series(
    session: Session,
    dashboard: KpiDashboard,
    series_ids: list[uuid.UUID],
) -> list[tuple[KpiSeries, KpiDefinition]]:
    if len(series_ids) < 1 or len(series_ids) > 10 or len(set(series_ids)) != len(series_ids):
        raise ApiError(400, "invalid_request")
    rows = session.execute(
        select(KpiSeries, KpiDefinition)
        .join(KpiDefinition, KpiDefinition.definition_id == KpiSeries.definition_id)
        .where(KpiSeries.series_id.in_(series_ids))
    ).all()
    if len(rows) != len(series_ids):
        raise ApiError(404, "not_found")
    department_id = dashboard.department_id
    if any(definition.department_id != department_id for _series, definition in rows):
        raise ApiError(409, "incompatible_series")
    if len({definition.cadence for _series, definition in rows}) != 1:
        raise ApiError(409, "incompatible_series")
    if len({definition.unit for _series, definition in rows}) > 2:
        raise ApiError(409, "incompatible_series")
    by_id = {series.series_id: (series, definition) for series, definition in rows}
    return [by_id[series_id] for series_id in series_ids]


def _axis_sides(
    selected: list[tuple[KpiSeries, KpiDefinition]],
    configured: list[Any] | None,
) -> dict[uuid.UUID, str]:
    units = list(dict.fromkeys(definition.unit for _series, definition in selected))
    default_by_unit = {unit: "left" if index == 0 else "right" for index, unit in enumerate(units)}
    overrides = {item.series_id: item.axis_side for item in configured or [] if item.axis_side is not None}
    side_by_unit: dict[str, str] = {}
    result: dict[uuid.UUID, str] = {}
    for series, definition in selected:
        side = overrides.get(series.series_id) or default_by_unit[definition.unit]
        if definition.unit in side_by_unit and side_by_unit[definition.unit] != side:
            raise ApiError(409, "incompatible_axes")
        side_by_unit[definition.unit] = side
        result[series.series_id] = side
    if len(set(side_by_unit.values())) != len(side_by_unit):
        raise ApiError(409, "incompatible_axes")
    return result


def _dashboard_periods(
    dashboard: KpiDashboard,
    cadence: Cadence,
    period_count: int,
    now: datetime,
) -> list[PeriodStart]:
    if dashboard.range_start is not None and dashboard.range_end is not None:
        return intersecting_period_starts(dashboard.range_start, dashboard.range_end, cadence)
    return last_period_starts(now, cadence, count=period_count)


def _next_widget_order(session: Session, dashboard_id: uuid.UUID) -> int:
    current = session.scalar(
        select(KpiDashboardWidget.sort_order)
        .where(KpiDashboardWidget.dashboard_id == dashboard_id)
        .order_by(KpiDashboardWidget.sort_order.desc())
        .limit(1)
    )
    return (current if current is not None else -1) + 1


def _widget_config_view(session: Session, widget: KpiDashboardWidget) -> WidgetView:
    links = session.scalars(
        select(KpiWidgetSeries)
        .where(KpiWidgetSeries.widget_id == widget.widget_id)
        .order_by(KpiWidgetSeries.sort_order)
    ).all()
    joined = session.execute(
        select(KpiSeries, KpiDefinition)
        .join(KpiDefinition, KpiDefinition.definition_id == KpiSeries.definition_id)
        .where(KpiSeries.series_id.in_([link.series_id for link in links]))
    ).all() if links else []
    by_id = {series.series_id: (series, definition) for series, definition in joined}
    return WidgetView(
        widgetId=widget.widget_id,
        dashboardId=widget.dashboard_id,
        title=widget.title,
        description=widget.description,
        sortOrder=widget.sort_order,
        gridX=widget.grid_x,
        gridY=widget.grid_y,
        gridWidth=widget.grid_width,
        gridHeight=widget.grid_height,
        periodCount=widget.period_count,
        showLinearTrend=widget.show_linear_trend,
        showMovingAverage=widget.show_moving_average,
        periods=[],
        series=[
            WidgetSeriesView(
                seriesId=(item := by_id[link.series_id])[0].series_id,
                definitionId=item[1].definition_id,
                name=item[1].name,
                unit=item[1].unit,
                precision=item[1].precision,
                cadence=item[1].cadence,
                label=item[0].label,
                axisSide=link.axis_side,
                color=link.series_color,
                points=[],
            )
            for link in links
        ],
    )


def _dashboard_header(dashboard: KpiDashboard) -> dict[str, Any]:
    return {
        "dashboardId": dashboard.dashboard_id,
        "departmentId": dashboard.department_id,
        "name": dashboard.name,
        "description": dashboard.description,
        "sortOrder": dashboard.sort_order,
        "rangeStart": dashboard.range_start,
        "rangeEnd": dashboard.range_end,
    }


def _matches_expected(current: datetime | None, expected: datetime | None) -> bool:
    if current is None or expected is None:
        return current is None and expected is None
    if expected.utcoffset() is None:
        return False
    return _aware(current) == expected.astimezone(timezone.utc)


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.utcoffset() is None else value.astimezone(timezone.utc)


def _decimal_text(value: Decimal) -> str:
    return format(value.normalize(), "f")


def _parse_period_start(value: str, cadence: Cadence) -> PeriodStart:
    try:
        period: PeriodStart = datetime.fromisoformat(value.replace("Z", "+00:00")) if cadence == "hour" else date.fromisoformat(value)
        if cadence == "hour" and (not isinstance(period, datetime) or period.utcoffset() is None):
            raise ValueError("hour periods require a timezone-aware timestamp")
        normalized = period_start_for(period, cadence)
        if isinstance(period, datetime):
            aligned = normalized.astimezone(timezone.utc) == period.astimezone(timezone.utc)
        else:
            aligned = normalized == period
        if not aligned:
            raise ValueError("period start is not aligned to cadence")
        return normalized
    except ValueError as error:
        raise ApiError(400, "invalid_period_start") from error


def _value_response(value: KpiValue, cadence: Cadence) -> dict[str, Any]:
    period = period_start_for(_aware(value.period_start), cadence)
    return {
        "seriesId": str(value.series_id),
        "periodStart": period.isoformat(),
        "value": _decimal_text(value.numeric_value),
        "comment": value.comment,
        "updatedAt": _aware(value.updated_at).isoformat().replace("+00:00", "Z"),
    }
