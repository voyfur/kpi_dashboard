# Project instructions

## Local KPI database safety

- Use the dedicated Docker Compose development database for local runs; never point it at the user's previous/original database unless explicitly requested.
- Its named volume is persistent across container restarts and `docker-compose down`; do not remove it or run `docker-compose down -v` unless explicitly requested.
- Local test actions may change this new development database. Keep the user's previous/original database untouched.
- The new development database starts empty; do not present it as containing the user's previous dashboards or import other data without an explicit request.
- Run local migrations only against the dedicated Compose database.
