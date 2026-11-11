"""Store line colors per widget series."""

from alembic import op
import sqlalchemy as sa


revision = "0006_widget_series_colors"
down_revision = "0005_widget_trend_options"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("kpi_widget_series", sa.Column("series_color", sa.String(length=7), nullable=True))


def downgrade() -> None:
    op.drop_column("kpi_widget_series", "series_color")
