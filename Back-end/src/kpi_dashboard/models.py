"""Relational storage for KPI departments, dashboards, and period values."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    PrimaryKeyConstraint,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from kpi_dashboard.db import Base


class KpiDepartment(Base):
    __tablename__ = "kpi_departments"
    __table_args__ = (
        CheckConstraint("length(btrim(name)) > 0", name="name_nonempty"),
        CheckConstraint(
            "color IS NULL OR color IN ('blue', 'teal', 'green', 'amber', 'rose', 'violet')",
            name="color_allowed",
        ),
        CheckConstraint("sort_order >= 0", name="sort_order_nonnegative"),
        Index("ix_kpi_departments_parent_sort", "parent_department_id", "sort_order"),
    )

    department_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    emoji: Mapped[str | None] = mapped_column(String(16))
    color: Mapped[str | None] = mapped_column(String(16))
    parent_department_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("kpi_departments.department_id", ondelete="RESTRICT"),
    )
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class KpiDashboard(Base):
    __tablename__ = "kpi_dashboards"
    __table_args__ = (
        CheckConstraint("length(btrim(name)) > 0", name="name_nonempty"),
        CheckConstraint("sort_order >= 0", name="sort_order_nonnegative"),
        CheckConstraint(
            "(range_start IS NULL AND range_end IS NULL) OR "
            "(range_start IS NOT NULL AND range_end IS NOT NULL AND range_start <= range_end)",
            name="date_range_shape",
        ),
        Index("ix_kpi_dashboards_department_sort", "department_id", "sort_order"),
    )

    dashboard_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    department_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("kpi_departments.department_id", ondelete="RESTRICT"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    range_start: Mapped[date | None] = mapped_column(Date)
    range_end: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class KpiDefinition(Base):
    __tablename__ = "kpi_definitions"
    __table_args__ = (
        CheckConstraint("length(btrim(name)) > 0", name="name_nonempty"),
        CheckConstraint("length(btrim(unit)) > 0", name="unit_nonempty"),
        CheckConstraint("precision >= 0", name="precision_nonnegative"),
        CheckConstraint(
            "cadence IN ('hour', 'day', 'week', 'month', 'year')", name="cadence_allowed"
        ),
        Index("ix_kpi_definitions_department", "department_id"),
    )

    definition_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    department_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("kpi_departments.department_id", ondelete="RESTRICT"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    unit: Mapped[str] = mapped_column(String(64), nullable=False)
    precision: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    cadence: Mapped[str] = mapped_column(String(8), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class KpiSeries(Base):
    __tablename__ = "kpi_series"
    __table_args__ = (
        CheckConstraint("length(btrim(label)) > 0", name="label_nonempty"),
        Index("ix_kpi_series_definition", "definition_id"),
    )

    series_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    definition_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("kpi_definitions.definition_id", ondelete="RESTRICT"),
        nullable=False,
    )
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class KpiDashboardWidget(Base):
    __tablename__ = "kpi_dashboard_widgets"
    __table_args__ = (
        CheckConstraint("length(btrim(title)) > 0", name="title_nonempty"),
        CheckConstraint("sort_order >= 0", name="sort_order_nonnegative"),
        CheckConstraint("grid_x >= 0 AND grid_y >= 0", name="grid_position_nonnegative"),
        CheckConstraint("grid_width > 0 AND grid_height > 0", name="grid_size_positive"),
        CheckConstraint("period_count > 0", name="period_count_positive"),
        Index("ix_kpi_dashboard_widgets_dashboard_sort", "dashboard_id", "sort_order"),
    )

    widget_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    dashboard_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("kpi_dashboards.dashboard_id", ondelete="RESTRICT"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    grid_x: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    grid_y: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    grid_width: Mapped[int] = mapped_column(Integer, nullable=False, default=6, server_default=text("6"))
    grid_height: Mapped[int] = mapped_column(Integer, nullable=False, default=4, server_default=text("4"))
    period_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=8, server_default=text("8")
    )
    show_linear_trend: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    show_moving_average: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class KpiWidgetSeries(Base):
    __tablename__ = "kpi_widget_series"
    __table_args__ = (
        CheckConstraint("sort_order >= 0", name="sort_order_nonnegative"),
        CheckConstraint("axis_side IN ('left', 'right')", name="axis_side_allowed"),
        PrimaryKeyConstraint("widget_id", "series_id"),
        UniqueConstraint("widget_id", "sort_order", name="uq_kpi_widget_series_order"),
    )

    widget_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("kpi_dashboard_widgets.widget_id", ondelete="CASCADE"),
        nullable=False,
    )
    series_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("kpi_series.series_id", ondelete="RESTRICT"),
        nullable=False,
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)
    axis_side: Mapped[str] = mapped_column(
        String(5), nullable=False, default="left", server_default=text("'left'")
    )
    series_color: Mapped[str | None] = mapped_column(String(7), nullable=True)


class KpiValue(Base):
    __tablename__ = "kpi_values"
    __table_args__ = (
        UniqueConstraint("series_id", "period_start", name="uq_kpi_values_series_period"),
    )

    value_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    series_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("kpi_series.series_id", ondelete="RESTRICT"),
        nullable=False,
    )
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    numeric_value: Mapped[Decimal] = mapped_column(Numeric(), nullable=False)
    comment: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
