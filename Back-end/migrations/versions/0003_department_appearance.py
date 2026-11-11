"""Add emoji and color options for KPI folders."""

from alembic import op
import sqlalchemy as sa


revision = "0003_department_appearance"
down_revision = "0002_department_hierarchy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("kpi_departments", sa.Column("emoji", sa.String(length=16), nullable=True))
    op.add_column("kpi_departments", sa.Column("color", sa.String(length=16), nullable=True))
    op.create_check_constraint(
        "color_allowed",
        "kpi_departments",
        "color IS NULL OR color IN ('blue', 'teal', 'green', 'amber', 'rose', 'violet')",
    )


def downgrade() -> None:
    op.drop_constraint("color_allowed", "kpi_departments", type_="check")
    op.drop_column("kpi_departments", "color")
    op.drop_column("kpi_departments", "emoji")
