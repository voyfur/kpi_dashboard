-- Run as a database administrator in the dedicated kpi_dashboard database.
-- Create the LOGIN role separately and supply its password out of band.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO kpi_app;
GRANT SELECT, INSERT, UPDATE ON
    kpi_departments,
    kpi_dashboards,
    kpi_definitions,
    kpi_series,
    kpi_dashboard_widgets,
    kpi_widget_series,
    kpi_values
TO kpi_app;
GRANT DELETE ON kpi_dashboard_widgets, kpi_widget_series, kpi_values TO kpi_app;

ALTER DEFAULT PRIVILEGES FOR ROLE kpi_migrator IN SCHEMA public
    REVOKE ALL ON TABLES FROM PUBLIC, kpi_app;
