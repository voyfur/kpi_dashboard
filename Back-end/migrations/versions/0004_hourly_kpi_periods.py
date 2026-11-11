"""Add hourly and daily KPI periods using Central Time."""

from alembic import op
import sqlalchemy as sa


revision = "0004_hourly_kpi_periods"
down_revision = "0003_department_appearance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(
        "ck_kpi_definitions_cadence_allowed",
        "kpi_definitions",
        type_="check",
    )
    op.create_check_constraint(
        "ck_kpi_definitions_cadence_allowed",
        "kpi_definitions",
        "cadence IN ('hour', 'day', 'week', 'month', 'year')",
    )
    op.alter_column(
        "kpi_values",
        "period_start",
        existing_type=sa.Date(),
        type_=sa.DateTime(timezone=True),
        existing_nullable=False,
        postgresql_using="period_start::timestamp AT TIME ZONE 'America/Chicago'",
    )


def downgrade() -> None:
    has_hourly_definitions = op.get_bind().execute(
        sa.text("SELECT EXISTS (SELECT 1 FROM kpi_definitions WHERE cadence = 'hour')")
    ).scalar()
    if has_hourly_definitions:
        raise RuntimeError("Cannot downgrade while hourly KPI definitions exist.")

    op.alter_column(
        "kpi_values",
        "period_start",
        existing_type=sa.DateTime(timezone=True),
        type_=sa.Date(),
        existing_nullable=False,
        postgresql_using="(period_start AT TIME ZONE 'America/Chicago')::date",
    )
    op.drop_constraint(
        "ck_kpi_definitions_cadence_allowed",
        "kpi_definitions",
        type_="check",
    )
    op.create_check_constraint(
        "ck_kpi_definitions_cadence_allowed",
        "kpi_definitions",
        "cadence IN ('week', 'month', 'year')",
    )
