---
id: "session-2026-11-11T13-24-13plus-02-00-update-kpi-project-wiki-and-agents-md-with-githu"
started_at: "2026-11-11T13:14:00+02:00"
ended_at: "2026-11-11T13:24:13+02:00"
timezone: "Europe/Kiev"
agent: "codex"
task: "Update KPI project Wiki and AGENTS.md with GitHub source and local credential locations"
status: "completed"
transcript_source: "faithful-summary"
summary: "Updated project guidance with the GitHub repository and sole main branch, plus the local ignored env-file locations. The root .env stores local database role passwords; Back-end/.env stores the local dev login including KPI_DEV_AUTH_PASSWORD. Only paths and key names were documented; no secret values were copied. Updated Wiki progress and local run status. The previously implemented KPI features remain published in main; manual UI checks still require signing in after the API rebuild."
files_changed: [{"path": "AGENTS.md", "action": "modified"}, {"path": "wiki/index.md", "action": "modified"}, {"path": "wiki/local-development.md", "action": "modified"}, {"path": "wiki/progress.md", "action": "modified"}]
tags: ["activity:documentation", "task:kpi-project-wiki", "component:local-development", "file:AGENTS.md", "file:wiki/index.md", "file:wiki/local-development.md", "file:wiki/progress.md"]
verification: [{"command": "git diff --check", "result": "passed"}, {"command": "python3 /Users/anatoly/.codex/skills/Wiki/scripts/lint_memory.py .", "result": "passed"}, {"command": "python3 /Users/anatoly/.codex/skills/Wiki/scripts/lint_content.py .", "result": "passed"}, {"command": "git check-ignore -v .env Back-end/.env", "result": "both credential files are ignored by Git"}, {"command": "List environment variable names without values in local env files", "result": "verified root database password keys and Back-end local dev auth keys; values were not displayed"}]
decisions: ["Document credential paths and variable names only; keep actual values in the ignored local env files.", "Use https://github.com/voyfur/kpi_dashboard and main as the project source of truth."]
open_tasks: ["After signing in to the rebuilt local app, manually verify hover tooltips, Cmd/Ctrl+C/V, and plot height with moving average on/off.", "Review the preserved detached checkout before any future cleanup."]
relevant_pages: ["AGENTS.md", "wiki/index.md", "wiki/progress.md", "wiki/local-development.md", "wiki/backlog.md"]
---

# Session

## Outcome

Updated project guidance with the GitHub repository and sole main branch, plus the local ignored env-file locations. The root .env stores local database role passwords; Back-end/.env stores the local dev login including KPI_DEV_AUTH_PASSWORD. Only paths and key names were documented; no secret values were copied. Updated Wiki progress and local run status. The previously implemented KPI features remain published in main; manual UI checks still require signing in after the API rebuild.

## Changed Files

- `AGENTS.md` — modified
- `wiki/index.md` — modified
- `wiki/local-development.md` — modified
- `wiki/progress.md` — modified

## Tags

- `activity:documentation`
- `task:kpi-project-wiki`
- `component:local-development`
- `file:AGENTS.md`
- `file:wiki/index.md`
- `file:wiki/local-development.md`
- `file:wiki/progress.md`

## Verification

- `git diff --check` — passed
- `python3 /Users/anatoly/.codex/skills/Wiki/scripts/lint_memory.py .` — passed
- `python3 /Users/anatoly/.codex/skills/Wiki/scripts/lint_content.py .` — passed
- `git check-ignore -v .env Back-end/.env` — both credential files are ignored by Git
- `List environment variable names without values in local env files` — verified root database password keys and Back-end local dev auth keys; values were not displayed
