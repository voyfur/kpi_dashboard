from sqlalchemy import Numeric, UniqueConstraint

import kpi_dashboard.models as models


TABLE_NAMES = {
    "kpi_departments",
    "kpi_dashboards",
    "kpi_definitions",
    "kpi_series",
    "kpi_dashboard_widgets",
    "kpi_widget_series",
    "kpi_values",
}


def _model(name):
    model = getattr(models, name, None)
    assert model is not None, f"KPI model {name} must be registered"
    return model


def test_kpi_schema_registers_all_shared_relational_tables():
    assert set(models.Base.metadata.tables) == TABLE_NAMES


def test_kpi_values_are_numeric_and_unique_per_series_and_period():
    value_model = _model("KpiValue")

    assert isinstance(value_model.__table__.c.numeric_value.type, Numeric)
    assert not value_model.__table__.c.numeric_value.nullable
    unique_pairs = {
        tuple(column.name for column in constraint.columns)
        for constraint in value_model.__table__.constraints
        if isinstance(constraint, UniqueConstraint)
    }
    assert ("series_id", "period_start") in unique_pairs


def test_kpi_definition_restricts_cadence_and_precision():
    definition_model = _model("KpiDefinition")
    checks = {
        constraint.sqltext
        for constraint in definition_model.__table__.constraints
        if hasattr(constraint, "sqltext")
    }
    assert any("cadence" in str(check) and all(value in str(check) for value in ("week", "month", "year")) for check in checks)
    assert any("precision" in str(check) and ">=" in str(check) for check in checks)


def test_dashboard_order_cannot_be_negative():
    dashboard_model = _model("KpiDashboard")
    checks = {
        str(constraint.sqltext)
        for constraint in dashboard_model.__table__.constraints
        if hasattr(constraint, "sqltext")
    }
    assert any("sort_order" in check and ">=" in check for check in checks)


def test_widget_grid_and_series_link_have_database_constraints():
    widget_model = _model("KpiDashboardWidget")
    widget_checks = {
        str(constraint.sqltext)
        for constraint in widget_model.__table__.constraints
        if hasattr(constraint, "sqltext")
    }
    series_checks = {
        str(constraint.sqltext)
        for constraint in models.KpiWidgetSeries.__table__.constraints
        if hasattr(constraint, "sqltext")
    }
    assert any("grid_width" in check and "> 0" in check for check in widget_checks)
    assert any("grid_height" in check and "> 0" in check for check in widget_checks)
    assert any("axis_side" in check and "left" in check and "right" in check for check in series_checks)
