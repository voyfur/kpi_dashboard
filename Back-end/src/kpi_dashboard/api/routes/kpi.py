"""Authenticated shared workspace for KPI dashboards and period values."""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any
import uuid

from fastapi import APIRouter, Depends, Request, Response, status
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
    current_period_start,
    intersecting_period_starts,
    last_period_starts,
    period_start_for,
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
                sortOrder=department.sort_order,
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
        department = KpiDepartment(name=payload.name, sort_order=payload.sort_order)
        session.add(department)
        session.flush()
        result = DepartmentView(
            departmentId=department.department_id,
            name=department.name,
            sortOrder=department.sort_order,
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
    if not payload.model_fields_set or (payload.name is None and payload.sort_order is None):
        raise ApiError(400, "invalid_request")
    if payload.name is not None and not payload.name:
        raise ApiError(400, "invalid_request")
    with _factory(request)() as session, session.begin():
        department = _required(session, KpiDepartment, department_id, "department_id")
        if payload.name is not None:
            department.name = payload.name
        if payload.sort_order is not None:
            department.sort_order = payload.sort_order
        session.flush()
        result = DepartmentView(
            departmentId=department.department_id,
            name=department.name,
            sortOrder=department.sort_order,
        )
    return result


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
        periods_by_widget: dict[uuid.UUID, list[date]] = {}
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
        all_periods = {period for periods in periods_by_widget.values() for period in periods}
        value_rows = session.scalars(
            select(KpiValue).where(
                KpiValue.series_id.in_(series_ids),
                KpiValue.period_start.in_(all_periods),
            )
        ).all() if series_ids and all_periods else []

    values = {(item.series_id, item.period_start): item for item in value_rows}
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
                value = values.get((series.series_id, period))
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
        for field_name in ("sort_order", "grid_x", "grid_y", "grid_width", "grid_height", "period_count"):
            value = getattr(payload, field_name)
            if value is not None:
                setattr(widget, field_name, value)
        if payload.series_ids is not None:
            selected = _load_compatible_series(session, dashboard, payload.series_ids)
            sides = _axis_sides(selected, payload.series)
            session.execute(delete(KpiWidgetSeries).where(KpiWidgetSeries.widget_id == widget_id))
            for order, (series, _definition) in enumerate(selected):
                session.add(
                    KpiWidgetSeries(
                        widget_id=widget_id,
                        series_id=series.series_id,
                        sort_order=order,
                        axis_side=sides[series.series_id],
                    )
                )
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
    period_start: date,
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
        if period_start_for(period_start, definition.cadence) != period_start:
            raise ApiError(400, "invalid_period_start")
        quantum = Decimal(1).scaleb(-definition.precision)
        if payload.value.quantize(quantum) != payload.value:
            raise ApiError(400, "invalid_precision")
        value = session.scalar(
            select(KpiValue)
            .where(KpiValue.series_id == series_id, KpiValue.period_start == period_start)
            .with_for_update()
        )
        if not _matches_expected(value.updated_at if value else None, payload.expected_updated_at):
            raise ApiError(409, "value_conflict")
        if value is None:
            value = KpiValue(series_id=series_id, period_start=period_start, numeric_value=payload.value)
            session.add(value)
        value.numeric_value = payload.value
        value.comment = _clean_optional_text(payload.comment)
        value.updated_at = datetime.now(timezone.utc)
        session.flush()
        result = _value_response(value)
    return result


@router.delete("/series/{series_id}/values/{period_start}")
def delete_value(
    series_id: uuid.UUID,
    period_start: date,
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
        value = session.scalar(
            select(KpiValue)
            .where(KpiValue.series_id == series_id, KpiValue.period_start == period_start)
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
    if len(series_ids) < 2 or len(series_ids) > 4 or len(set(series_ids)) != len(series_ids):
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
) -> list[date]:
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


def _value_response(value: KpiValue) -> dict[str, Any]:
    return {
        "seriesId": str(value.series_id),
        "periodStart": value.period_start.isoformat(),
        "value": _decimal_text(value.numeric_value),
        "comment": value.comment,
        "updatedAt": _aware(value.updated_at).isoformat().replace("+00:00", "Z"),
    }
