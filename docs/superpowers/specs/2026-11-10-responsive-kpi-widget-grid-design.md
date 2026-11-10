# Responsive KPI widget grid and empty-space placement

**Status:** Draft for user review — hybrid layout selected, implementation not started
**Project:** KPI Dashboards
**Related context:** `../../../README.md`, `../../../Front-end/app/src/pages/KpiPage.tsx`, `../../../Front-end/app/src/domain/kpi.ts`

## 1. Goal

Use empty space in the dashboard grid when a widget fits, and let an administrator drag a widget into a free area. The layout must adapt to the available screen width and retain its saved desktop arrangement when the page is reopened.

## 2. Current behavior

- The desktop dashboard uses 12 CSS grid columns. Widget width controls the number of columns a card spans; height controls the card's rendered height.
- The frontend sorts widgets by `sortOrder` and lets CSS auto-place them. It does not use `gridX` or `gridY`.
- The API and database already accept and return `gridX` and `gridY`, but the frontend update type and layout behavior do not use them.
- Dragging a widget grip and dropping on another card changes list order. The empty grid is not a drop target.
- At viewport widths up to 700px, cards stack at full width.

## 3. Proposed behavior

### Automatic placement

- Keep a 12-column coordinate system for wide layouts. Column widths follow the available dashboard width; positions are expressed as grid columns and rows, not screen pixels.
- On widget creation, find a free location that fits its selected width before adding another row. Prefer a fitting opening beside the Add Widget tile in the trailing row, then scan other empty locations from top to bottom and left to right.
- The Add Widget tile participates in the temporary placement calculation so a small new chart can occupy the open space beside it. After a chart uses that space, the tile moves to the next available fitting location.
- If a widget is resized and its current location still fits, retain it. If the new width would overlap another widget, move the resized widget to the nearest free location that fits.
- Existing widgets do not overlap. Their contents and values are unaffected by layout changes.

### Manual placement

- Keep the current drag grip. While dragging, show a snapped preview in the nearest valid empty grid location.
- Dropping on an empty location saves that widget's `gridX` and `gridY`.
- Dropping on another card keeps the existing reorder interaction. The resulting wide layout is packed in the new `sortOrder`; an exact empty-cell drop preserves the manually chosen position.
- If a drag ends over an occupied location without targeting that card as a reorder target, do not save an overlapping placement; keep the widget at its last saved location.

### Responsive behavior

- On wide screens, the 12-column grid and saved coordinates determine placement; the columns expand or contract with the dashboard container.
- At the existing narrow-screen breakpoint, show cards as a single full-width column in `sortOrder`. Do not overwrite saved wide-screen coordinates when the narrow layout is displayed; restore them when the page becomes wide again.

## 4. Data and implementation boundaries

- Use the existing persisted `gridX`, `gridY`, `gridWidth`, and `gridHeight` fields. No database migration is expected.
- Extend the frontend widget update type to send `gridX` and `gridY` through the existing API.
- Put collision checks and first-fit placement in a small pure frontend layout helper. `KpiPage` owns drag/drop, preview, and persistence; the Add Widget dialog remains responsible for widget configuration.
- Existing widgets whose positions collide because they were all saved at the default `(0, 0)` are treated as legacy layout. Derive their initial non-overlapping positions from `sortOrder` and width, preserving current visible order as closely as possible. Do not write those derived positions merely on page load; persist them with the next successful layout change.
- If layout persistence fails, restore the last saved positions and use the existing dashboard error handling.

## 5. Acceptance checks

1. With three 4-column widgets in the first row and a 6-column Add Widget tile at the start of the next row, a new 3- or 4-column widget is placed in the remaining space to the right when it fits.
2. If it does not fit, the new widget is placed in the next available location without overlap.
3. An administrator can drag a widget created at the bottom into a highlighted empty area; the chosen location remains after refreshing the dashboard.
4. Dropping on an occupied card preserves the current reorder action.
5. Resizing to a width that collides relocates only the resized widget to a free fitting location.
6. Narrow-screen layout remains a single full-width column; returning to a wide screen restores the saved grid positions.
7. Existing values, series, and titles remain unchanged during placement and resize.

## 6. Verification

- Run the frontend TypeScript check and `git diff --check`.
- In a browser, verify the empty-space placement, drag preview/drop, persistence after reload, resize collision handling, and narrow-to-wide responsive behavior.
- Do not run the automated test suites unless the user asks for them.
