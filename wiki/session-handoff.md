# Session Handoff

## Active Context

- Last session: `raw/sessions/2026-11-11-update-kpi-project-wiki-and-agents-md-with-githu.md`
- Current objective: Update KPI project Wiki and AGENTS.md with GitHub source and local credential locations

## Current Decisions

- Use https://github.com/voyfur/kpi_dashboard and `main` as the project source of truth; it is the only branch.
- Copy/paste applies to the selected widget in the current dashboard. The duplicate preserves its configuration and is placed in the first free grid position.
- The moving-average caption sits outside the normal legend flow so it does not reduce plot height.
- Point tooltips display saved comments; this behavior was already present in the active implementation.
- Document credential file paths and variable names only. Keep actual values in ignored local `.env` files.

## Current Status

- Application changes were published in `c209285`; Wiki and handoff updates are in later `main` commits.
- `AGENTS.md` and the Wiki identify root `.env` for local database role passwords and `Back-end/.env` for `KPI_DEV_AUTH_PASSWORD`; the values are not committed.
- The API/frontend were rebuilt. The browser session ended at sign-in, so the remaining interaction checks have not been completed.

## Open Tasks

- After signing in to the rebuilt local app, manually verify hover tooltips, Cmd/Ctrl+C/V, and plot height with moving average on/off.
- Review the preserved detached checkout before any future cleanup.

## Blockers

- No blockers recorded.

## Next Action

- Review the latest session and continue only with verified context.

## Relevant Pages

- AGENTS.md
- wiki/index.md
- wiki/progress.md
- wiki/local-development.md
- wiki/backlog.md
