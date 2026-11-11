"""Add parent links for KPI departments."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0002_department_hierarchy"
down_revision = "0001_kpi_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "kpi_departments",
        sa.Column("parent_department_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_kpi_departments_parent_department_id_kpi_departments",
        "kpi_departments",
        "kpi_departments",
        ["parent_department_id"],
        ["department_id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "ix_kpi_departments_parent_sort",
        "kpi_departments",
        ["parent_department_id", "sort_order"],
    )


def downgrade() -> None:
    op.drop_index("ix_kpi_departments_parent_sort", table_name="kpi_departments")
    op.drop_constraint(
        "fk_kpi_departments_parent_department_id_kpi_departments",
        "kpi_departments",
        type_="foreignkey",
    )
    op.drop_column("kpi_departments", "parent_department_id")
