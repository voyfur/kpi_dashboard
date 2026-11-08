"""Create the standalone KPI dashboard schema."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0001_kpi_schema"
down_revision = None
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.create_table(
        "kpi_departments",
        sa.Column("department_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("length(btrim(name)) > 0", name=op.f("ck_kpi_departments_name_nonempty")),
        sa.CheckConstraint("sort_order >= 0", name=op.f("ck_kpi_departments_sort_order_nonnegative")),
        sa.PrimaryKeyConstraint("department_id", name=op.f("pk_kpi_departments")),
    )
    op.create_table(
        "kpi_dashboards",
        sa.Column("dashboard_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("department_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("range_start", sa.Date(), nullable=True),
        sa.Column("range_end", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("length(btrim(name)) > 0", name=op.f("ck_kpi_dashboards_name_nonempty")),
        sa.CheckConstraint("sort_order >= 0", name=op.f("ck_kpi_dashboards_sort_order_nonnegative")),
        sa.CheckConstraint(
            "(range_start IS NULL AND range_end IS NULL) OR "
            "(range_start IS NOT NULL AND range_end IS NOT NULL AND range_start <= range_end)",
            name=op.f("ck_kpi_dashboards_date_range_shape"),
        ),
        sa.ForeignKeyConstraint(
            ["department_id"],
            ["kpi_departments.department_id"],
            name=op.f("fk_kpi_dashboards_department_id_kpi_departments"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("dashboard_id", name=op.f("pk_kpi_dashboards")),
    )
    op.create_index(
        "ix_kpi_dashboards_department_sort",
        "kpi_dashboards",
        ["department_id", "sort_order"],
    )
    op.create_table(
        "kpi_definitions",
        sa.Column("definition_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("department_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("unit", sa.String(length=64), nullable=False),
        sa.Column("precision", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("cadence", sa.String(length=8), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("length(btrim(name)) > 0", name=op.f("ck_kpi_definitions_name_nonempty")),
        sa.CheckConstraint("length(btrim(unit)) > 0", name=op.f("ck_kpi_definitions_unit_nonempty")),
        sa.CheckConstraint("precision >= 0", name=op.f("ck_kpi_definitions_precision_nonnegative")),
        sa.CheckConstraint(
            "cadence IN ('week', 'month', 'year')",
            name=op.f("ck_kpi_definitions_cadence_allowed"),
        ),
        sa.ForeignKeyConstraint(
            ["department_id"],
            ["kpi_departments.department_id"],
            name=op.f("fk_kpi_definitions_department_id_kpi_departments"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("definition_id", name=op.f("pk_kpi_definitions")),
    )
    op.create_index("ix_kpi_definitions_department", "kpi_definitions", ["department_id"])
    op.create_table(
        "kpi_series",
        sa.Column("series_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("definition_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("length(btrim(label)) > 0", name=op.f("ck_kpi_series_label_nonempty")),
        sa.ForeignKeyConstraint(
            ["definition_id"],
            ["kpi_definitions.definition_id"],
            name=op.f("fk_kpi_series_definition_id_kpi_definitions"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("series_id", name=op.f("pk_kpi_series")),
    )
    op.create_index("ix_kpi_series_definition", "kpi_series", ["definition_id"])
    op.create_table(
        "kpi_dashboard_widgets",
        sa.Column("widget_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("dashboard_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("grid_x", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("grid_y", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("grid_width", sa.Integer(), server_default=sa.text("6"), nullable=False),
        sa.Column("grid_height", sa.Integer(), server_default=sa.text("4"), nullable=False),
        sa.Column("period_count", sa.Integer(), server_default=sa.text("8"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("length(btrim(title)) > 0", name=op.f("ck_kpi_dashboard_widgets_title_nonempty")),
        sa.CheckConstraint("sort_order >= 0", name=op.f("ck_kpi_dashboard_widgets_sort_order_nonnegative")),
        sa.CheckConstraint(
            "grid_x >= 0 AND grid_y >= 0",
            name=op.f("ck_kpi_dashboard_widgets_grid_position_nonnegative"),
        ),
        sa.CheckConstraint(
            "grid_width > 0 AND grid_height > 0",
            name=op.f("ck_kpi_dashboard_widgets_grid_size_positive"),
        ),
        sa.CheckConstraint(
            "period_count > 0",
            name=op.f("ck_kpi_dashboard_widgets_period_count_positive"),
        ),
        sa.ForeignKeyConstraint(
            ["dashboard_id"],
            ["kpi_dashboards.dashboard_id"],
            name=op.f("fk_kpi_dashboard_widgets_dashboard_id_kpi_dashboards"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("widget_id", name=op.f("pk_kpi_dashboard_widgets")),
    )
    op.create_index(
        "ix_kpi_dashboard_widgets_dashboard_sort",
        "kpi_dashboard_widgets",
        ["dashboard_id", "sort_order"],
    )
    op.create_table(
        "kpi_widget_series",
        sa.Column("widget_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("series_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("axis_side", sa.String(length=5), server_default=sa.text("'left'"), nullable=False),
        sa.CheckConstraint("sort_order >= 0", name=op.f("ck_kpi_widget_series_sort_order_nonnegative")),
        sa.CheckConstraint(
            "axis_side IN ('left', 'right')",
            name=op.f("ck_kpi_widget_series_axis_side_allowed"),
        ),
        sa.ForeignKeyConstraint(
            ["widget_id"],
            ["kpi_dashboard_widgets.widget_id"],
            name=op.f("fk_kpi_widget_series_widget_id_kpi_dashboard_widgets"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["series_id"],
            ["kpi_series.series_id"],
            name=op.f("fk_kpi_widget_series_series_id_kpi_series"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint(
            "widget_id", "series_id", name=op.f("pk_kpi_widget_series")
        ),
        sa.UniqueConstraint(
            "widget_id", "sort_order", name=op.f("uq_kpi_widget_series_order")
        ),
    )
    op.create_table(
        "kpi_values",
        sa.Column("value_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("series_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("numeric_value", sa.Numeric(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["series_id"],
            ["kpi_series.series_id"],
            name=op.f("fk_kpi_values_series_id_kpi_series"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("value_id", name=op.f("pk_kpi_values")),
        sa.UniqueConstraint(
            "series_id", "period_start", name=op.f("uq_kpi_values_series_period")
        ),
    )



def downgrade() -> None:
    raise NotImplementedError("The initial KPI schema is forward-only; preserve dashboard data.")
