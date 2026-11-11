# Project instructions

## GitHub source of truth

- GitHub repository: `https://github.com/voyfur/kpi_dashboard` (`origin`).
- Use the `main` branch; it is the only local and remote branch. Keep project changes on `main` unless the user asks otherwise.

## Local credential file locations

- Repository-root `.env` is ignored by Git and contains local Compose database passwords: `KPI_POSTGRES_PASSWORD`, `KPI_MIGRATOR_PASSWORD`, and `KPI_APP_PASSWORD`.
- `Back-end/.env` is ignored by Git and contains the local development login: `KPI_DEV_AUTH_EMAIL` and `KPI_DEV_AUTH_PASSWORD`.
- Record file paths and variable names only. Never put actual credential values in Git, Wiki, logs, or chat.

## Local KPI database safety

- Use the dedicated Docker Compose development database for local runs; never point it at the user's previous/original database unless explicitly requested.
- Its named volume is persistent across container restarts and `docker-compose down`; do not remove it or run `docker-compose down -v` unless explicitly requested.
- Local test actions may change this new development database. Keep the user's previous/original database untouched.
- The new development database starts empty; do not present it as containing the user's previous dashboards or import other data without an explicit request.
- Run local migrations only against the dedicated Compose database.
