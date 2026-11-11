#!/bin/sh
set -eu

uv run alembic upgrade head

PGPASSWORD="$KPI_MIGRATOR_PASSWORD" psql \
  --host=db \
  --username=kpi_migrator \
  --dbname=kpi_dashboard \
  --set=ON_ERROR_STOP=1 \
  --file=sql/kpi_app_grants.sql
