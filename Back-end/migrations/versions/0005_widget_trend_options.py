"""Persist trend and moving-average options on KPI widgets."""

from alembic import op
import sqlalchemy as sa


revision = "0005_widget_trend_options"
down_revision = "0004_hourly_kpi_periods"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "kpi_dashboard_widgets",
        sa.Column("show_linear_trend", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.add_column(
        "kpi_dashboard_widgets",
        sa.Column("show_moving_average", sa.Boolean(), server_default=sa.false(), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("kpi_dashboard_widgets", "show_moving_average")
    op.drop_column("kpi_dashboard_widgets", "show_linear_trend")
