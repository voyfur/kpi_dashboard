---
description: "Prepare a validated, tagged session record for the project LLM Wiki"
---

# Save Memory

Save this session into project memory.

Follow the local memory workflow and use `/prompts:save-memory` in Codex when available.

1. Read `AGENTS.md`.
2. Read `wiki/index.md`.
3. Read `wiki/session-handoff.md` if present.
4. Read `PROGRESS.md` and `PLAN.md` if present.
5. Extract only durable knowledge from the current chat:
   - new sources
   - decisions
   - architecture or workflow changes
   - current status
   - next steps
   - reusable explanations
   - changed files
   - commands and verification results
6. Ignore raw chat, temporary reasoning, secrets, credentials, and private data.
7. Create a JSON payload that includes required ISO-8601 timestamps with timezone, agent, task, status, transcript source, summary, changed files, verification and tags.
8. Use typed tags: one `activity:` value from the controlled vocabulary, plus useful `task:`, `component:`, `file:`, `topic:` and `status:` values. Add `file:` for every materially changed file.
9. Run `python3 .agents/skills/llm-wiki-session-memory/scripts/save_memory.py . /path/to/session.json`.
10. Run `python3 .agents/skills/llm-wiki-session-memory/scripts/lint_memory.py .`.
11. Update the smallest relevant maintained files:
   - `wiki/session-handoff.md` for active continuity
   - `PROGRESS.md` for status and next step
   - `PLAN.md` for plan changes
   - `AGENTS.md` for working rules
   - `wiki/sources/` for source summaries
   - `wiki/concepts/` for reusable concepts
   - `wiki/entities/` for entities
   - `wiki/syntheses/` for integrated understanding
   - `wiki/dev/decisions.md` or `wiki/decisions.md` for durable decisions
12. Update `wiki/index.md` if pages were added.
13. Run available project self-checks.
14. Report changed files and what was intentionally ignored.
