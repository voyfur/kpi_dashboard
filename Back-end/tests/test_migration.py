from importlib.util import module_from_spec, spec_from_file_location
from io import StringIO
from pathlib import Path

from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory


BACKEND_ROOT = Path(__file__).resolve().parents[1]


def test_standalone_schema_has_its_own_initial_migration_head():
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "migrations"))
    scripts = ScriptDirectory.from_config(config)

    revision = scripts.get_revision("0001_kpi_schema")

    assert revision is not None
    assert revision.down_revision is None
    assert scripts.get_current_head() == "0006_widget_series_colors"


def test_initial_migration_creates_seven_shared_kpi_tables():
    migration_path = BACKEND_ROOT / "migrations" / "versions" / "0001_kpi_schema.py"
    spec = spec_from_file_location("kpi_schema_migration", migration_path)
    assert spec is not None and spec.loader is not None
    migration = module_from_spec(spec)
    spec.loader.exec_module(migration)

    output = StringIO()
    context = MigrationContext.configure(
        dialect_name="postgresql",
        opts={"as_sql": True, "output_buffer": output},
    )
    with Operations.context(context):
        migration.upgrade()

    sql = output.getvalue().lower()
    for table in (
        "kpi_departments",
        "kpi_dashboards",
        "kpi_definitions",
        "kpi_series",
        "kpi_dashboard_widgets",
        "kpi_widget_series",
        "kpi_values",
    ):
        assert f"create table {table}" in sql
    assert "numeric_value numeric not null" in sql
    assert "unique (series_id, period_start)" in sql
    assert "auth_users" not in sql
    assert "auth_sessions" not in sql


def test_runtime_grants_are_limited_to_kpi_tables():
    grants = (BACKEND_ROOT / "sql" / "kpi_app_grants.sql").read_text().lower()

    assert "to kpi_app" in grants
    assert "kpi_values" in grants
    assert "auth_users" not in grants
    assert "auth_sessions" not in grants
    assert "grant select, insert, update on tables to kpi_app" not in grants
    assert "revoke all on tables from public, kpi_app" in grants
