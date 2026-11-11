#!/bin/sh
set -eu

: "${KPI_MIGRATOR_PASSWORD:?KPI_MIGRATOR_PASSWORD is required}"
: "${KPI_APP_PASSWORD:?KPI_APP_PASSWORD is required}"

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=ON_ERROR_STOP=1 \
  --set=migrator_password="$KPI_MIGRATOR_PASSWORD" \
  --set=app_password="$KPI_APP_PASSWORD" <<'SQL'
CREATE ROLE kpi_migrator LOGIN PASSWORD :'migrator_password';
CREATE ROLE kpi_app LOGIN PASSWORD :'app_password';
CREATE DATABASE kpi_dashboard OWNER kpi_migrator;
\connect kpi_dashboard
GRANT CREATE ON SCHEMA public TO kpi_migrator;
GRANT USAGE ON SCHEMA public TO kpi_app;
SQL
