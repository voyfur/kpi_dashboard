"""Request and response contracts for the shared KPI workspace."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal
import uuid

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


Cadence = Literal["week", "month", "year"]


class KpiRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class CreateDepartmentRequest(KpiRequest):
    name: str = Field(min_length=1, max_length=120)
    sort_order: int = Field(default=0, alias="sortOrder", ge=0)

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        return value.strip()


class UpdateDepartmentRequest(KpiRequest):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    sort_order: int | None = Field(default=None, alias="sortOrder", ge=0)

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None


class CreateDashboardRequest(KpiRequest):
    name: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=4000)
    sort_order: int = Field(default=0, alias="sortOrder", ge=0)

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        return value.strip()


class UpdateDashboardRequest(KpiRequest):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=4000)
    sort_order: int | None = Field(default=None, alias="sortOrder", ge=0)
    range_start: date | None = Field(default=None, alias="rangeStart")
    range_end: date | None = Field(default=None, alias="rangeEnd")

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None

    @model_validator(mode="after")
    def range_pair(self) -> "UpdateDashboardRequest":
        fields = self.model_fields_set
        if ("range_start" in fields) != ("range_end" in fields):
            raise ValueError("rangeStart and rangeEnd must be supplied together")
        if self.range_start is not None and self.range_end is not None and self.range_start > self.range_end:
            raise ValueError("rangeStart must not be after rangeEnd")
        return self


class CreateDefinitionRequest(KpiRequest):
    name: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=4000)
    unit: str = Field(min_length=1, max_length=64)
    precision: int = Field(default=0, ge=0, le=8)
    cadence: Cadence
    series_labels: list[str] = Field(default_factory=list, alias="seriesLabels", max_length=4)

    @field_validator("name", "unit")
    @classmethod
    def trim_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("series_labels")
    @classmethod
    def trim_series_labels(cls, values: list[str]) -> list[str]:
        labels = [value.strip() for value in values]
        if any(not label or len(label) > 120 for label in labels) or len(set(labels)) != len(labels):
            raise ValueError("series labels must be nonempty and unique")
        return labels


class CreateSeriesRequest(KpiRequest):
    label: str = Field(min_length=1, max_length=120)

    @field_validator("label")
    @classmethod
    def trim_label(cls, value: str) -> str:
        return value.strip()


class UpdateSeriesRequest(KpiRequest):
    label: str = Field(min_length=1, max_length=120)

    @field_validator("label")
    @classmethod
    def trim_label(cls, value: str) -> str:
        return value.strip()


class UpdateDefinitionRequest(KpiRequest):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=4000)
    unit: str | None = Field(default=None, min_length=1, max_length=64)
    precision: int | None = Field(default=None, ge=0, le=8)
    cadence: Cadence | None = None

    @field_validator("name", "unit")
    @classmethod
    def trim_optional_text(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None


class SeriesChoice(KpiRequest):
    series_id: uuid.UUID = Field(alias="seriesId")
    axis_side: Literal["left", "right"] | None = Field(default=None, alias="axisSide")


class CreateWidgetRequest(KpiRequest):
    title: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=4000)
    series_ids: list[uuid.UUID] = Field(alias="seriesIds", min_length=2, max_length=4)
    period_count: int = Field(default=8, alias="periodCount", ge=1, le=60)
    grid_x: int = Field(default=0, alias="gridX", ge=0, le=11)
    grid_y: int = Field(default=0, alias="gridY", ge=0)
    grid_width: int = Field(default=6, alias="gridWidth", ge=3, le=12)
    grid_height: int = Field(default=4, alias="gridHeight", ge=2, le=12)
    series: list[SeriesChoice] | None = None

    @field_validator("title")
    @classmethod
    def trim_title(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def series_shape(self) -> "CreateWidgetRequest":
        if len(set(self.series_ids)) != len(self.series_ids):
            raise ValueError("seriesIds must be unique")
        if self.series is not None and {item.series_id for item in self.series} != set(self.series_ids):
            raise ValueError("series must match seriesIds")
        return self


class UpdateWidgetRequest(KpiRequest):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=4000)
    series_ids: list[uuid.UUID] | None = Field(default=None, alias="seriesIds", min_length=2, max_length=4)
    series: list[SeriesChoice] | None = None
    sort_order: int | None = Field(default=None, alias="sortOrder", ge=0)
    grid_x: int | None = Field(default=None, alias="gridX", ge=0, le=11)
    grid_y: int | None = Field(default=None, alias="gridY", ge=0)
    grid_width: int | None = Field(default=None, alias="gridWidth", ge=3, le=12)
    grid_height: int | None = Field(default=None, alias="gridHeight", ge=2, le=12)
    period_count: int | None = Field(default=None, alias="periodCount", ge=1, le=60)

    @field_validator("title")
    @classmethod
    def trim_title(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None

    @model_validator(mode="after")
    def series_shape(self) -> "UpdateWidgetRequest":
        if self.series_ids is not None and len(set(self.series_ids)) != len(self.series_ids):
            raise ValueError("seriesIds must be unique")
        if self.series is not None:
            if self.series_ids is None or {item.series_id for item in self.series} != set(self.series_ids):
                raise ValueError("series must match seriesIds")
        return self


class WriteValueRequest(KpiRequest):
    value: Decimal
    comment: str | None = Field(default=None, max_length=4000)
    expected_updated_at: datetime | None = Field(default=None, alias="expectedUpdatedAt")

    @field_validator("value")
    @classmethod
    def finite_value(cls, value: Decimal) -> Decimal:
        if not value.is_finite():
            raise ValueError("value must be finite")
        return value


class DeleteValueRequest(KpiRequest):
    expected_updated_at: datetime = Field(alias="expectedUpdatedAt")


class DepartmentView(KpiRequest):
    department_id: uuid.UUID = Field(alias="departmentId")
    name: str
    sort_order: int = Field(alias="sortOrder")


class DashboardListView(KpiRequest):
    dashboard_id: uuid.UUID = Field(alias="dashboardId")
    department_id: uuid.UUID = Field(alias="departmentId")
    name: str
    description: str | None
    sort_order: int = Field(alias="sortOrder")


class DefinitionView(KpiRequest):
    definition_id: uuid.UUID = Field(alias="definitionId")
    department_id: uuid.UUID = Field(alias="departmentId")
    name: str
    description: str | None
    unit: str
    precision: int
    cadence: Cadence
    series: list[dict]


class ValuePointView(KpiRequest):
    period_start: date = Field(alias="periodStart")
    value: str | None
    comment: str | None
    updated_at: datetime | None = Field(alias="updatedAt")
    is_current_period: bool = Field(alias="isCurrentPeriod")


class WidgetSeriesView(KpiRequest):
    series_id: uuid.UUID = Field(alias="seriesId")
    definition_id: uuid.UUID = Field(alias="definitionId")
    name: str
    unit: str
    precision: int
    cadence: Cadence
    label: str
    axis_side: Literal["left", "right"] = Field(alias="axisSide")
    points: list[ValuePointView]


class WidgetView(KpiRequest):
    widget_id: uuid.UUID = Field(alias="widgetId")
    dashboard_id: uuid.UUID = Field(alias="dashboardId")
    title: str
    description: str | None
    sort_order: int = Field(alias="sortOrder")
    grid_x: int = Field(alias="gridX")
    grid_y: int = Field(alias="gridY")
    grid_width: int = Field(alias="gridWidth")
    grid_height: int = Field(alias="gridHeight")
    period_count: int = Field(alias="periodCount")
    periods: list[date]
    series: list[WidgetSeriesView]


class DashboardDetailView(KpiRequest):
    dashboard_id: uuid.UUID = Field(alias="dashboardId")
    department_id: uuid.UUID = Field(alias="departmentId")
    name: str
    description: str | None
    sort_order: int = Field(alias="sortOrder")
    range_start: date | None = Field(alias="rangeStart")
    range_end: date | None = Field(alias="rangeEnd")
    department: DepartmentView
    widgets: list[WidgetView]
