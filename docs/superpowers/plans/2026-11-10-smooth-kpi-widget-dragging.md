# Smooth KPI Widget Dragging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let administrators drag KPI widgets from blank card surfaces, preview their destination in the 12-column grid, and smoothly reflow other widgets while saving exact empty-cell positions or the order selected on an occupied card.

**Architecture:** Add pure frontend grid-placement helpers for legacy-position normalization, collision checks, first-fit creation, and drag previews. `KpiPage` owns pointer input, optimistic drag layout, persistence, rollback, and FLIP animation; `KpiAddWidgetDialog` uses the same placement helpers for create/edit dimensions and submits coordinates through the existing API. The existing FastAPI API and database already support `gridX` and `gridY`, so no backend endpoint or migration is planned.

**Tech Stack:** React 19, TypeScript, CSS Grid, Pointer Events, existing FastAPI widget endpoints. No new frontend dependency.

---

## Working Tree Safeguards

- The current `KPI Dashboards` checkout is on `main` at `9abd315` and contains broad uncommitted frontend and backend changes. Preserve them; do not reset, stash, stage whole files, or commit unrelated hunks.
- The existing `/private/tmp/kpi-dashboard-live-sync` worktree is at older commit `df706f9` and does not include the current working changes. Implement in the current checkout unless the user asks for a new isolated worktree.
- The server already accepts and returns `gridX`/`gridY`; only the frontend request types omit them.
- The approved spec says not to run automated test suites unless the user asks. Add no test files in this plan. Use the required type check, diff check, and manual browser checks.

## File Map

| File | Responsibility in this change |
|---|---|
| `Front-end/app/src/domain/kpiLayout.ts` | New pure helpers for grid collisions, legacy position derivation, packing, and free-cell selection. |
| `Front-end/app/src/data/kpiRepository.ts` | Add `gridX`/`gridY` to create and update request types. |
| `Front-end/app/src/pages/KpiAddWidgetDialog.tsx` | Submit a free position for new widgets and a collision-free position when size changes. |
| `Front-end/app/src/pages/KpiPage.tsx` | Normalize loaded layouts, render stored positions, handle pointer drag/preview, resize collisions, persistence, rollback, and Add Widget placement. |
| `Front-end/app/src/styles/kpi.css` | Four-way move cursor, floating preview, placeholder, FLIP transitions, and reduced-motion rules. |

### Coordinate model

Use 12 logical columns. `gridX` and `gridY` are zero-based cell coordinates; `gridWidth` and the rendered card height determine the occupied rectangle. Preserve the current responsive height formula. On wide layouts, map one vertical cell to a 52 px step using fixed CSS Grid rows of 35 px plus a 17 px row gap. For a widget, compute `rowSpan = ceil((renderedHeightPx + 17) / 52)` and set `gridRow` to `gridY + 1 / span rowSpan`; this gives the spanned tracks enough space for the card at the current grid container width. Use the same fixed-row model for the Add Widget tile from its 264 px minimum height. Include both width and row span in every overlap check. At the narrow breakpoint, restore auto-sized single-column rows and keep the persisted wide-layout coordinates untouched.

## Task 1: Add Pure Grid Placement Helpers

**Files:**
- Create: `Front-end/app/src/domain/kpiLayout.ts`
- Reference: `Front-end/app/src/data/kpiRepository.ts:49-65` (`KpiWidget` fields)

- [x] **Step 1: Define placement types and the 12-column overlap rule**

Add a `KpiGridItem` type with `widgetId`, `sortOrder`, `gridX`, `gridY`, `gridWidth`, `gridHeight`, and derived `rowSpan`. A collision exists when the half-open column ranges and half-open row ranges both intersect:

```ts
export const KPI_GRID_COLUMNS = 12;
export const KPI_GRID_ROW_TRACK_PX = 35;
export const KPI_GRID_ROW_GAP_PX = 17;
export const KPI_GRID_ROW_STEP_PX = KPI_GRID_ROW_TRACK_PX + KPI_GRID_ROW_GAP_PX;

export type KpiGridItem = {
  widgetId: string;
  sortOrder: number;
  gridX: number;
  gridY: number;
  gridWidth: number;
  gridHeight: number;
  rowSpan: number;
};

export type KpiGridPosition = Pick<KpiGridItem, 'gridX' | 'gridY'>;
export type KpiGridRectangle = Pick<KpiGridItem, 'gridX' | 'gridY' | 'gridWidth' | 'rowSpan'>;

export function kpiGridItemsOverlap(left: KpiGridRectangle, right: KpiGridRectangle): boolean {
  const columnsOverlap = left.gridX < right.gridX + right.gridWidth
    && right.gridX < left.gridX + left.gridWidth;
  const rowsOverlap = left.gridY < right.gridY + right.rowSpan
    && right.gridY < left.gridY + left.rowSpan;
  return columnsOverlap && rowsOverlap;
}

export function getKpiGridRowSpan(gridWidth: number, gridHeight: number, containerWidth: number): number {
  const renderedHeight = Math.max(250, 204
    + (gridWidth / KPI_GRID_COLUMNS * 0.322 * containerWidth)
    + (gridHeight - 4) * 52);
  return Math.max(1, Math.ceil((renderedHeight + KPI_GRID_ROW_GAP_PX) / KPI_GRID_ROW_STEP_PX));
}
```

- [x] **Step 2: Implement first-fit placement and bounded coordinates**

Add `findFirstKpiGridPosition(width, rowSpan, occupied)` that scans row origins from `gridY = 0` upward and columns from left to right. Clamp width to `3..12`, and scan `gridX` through `0..12-width`. Return the first rectangle with no overlap. Add `clampKpiGridPosition(item)` to constrain `gridX` to `0..12-gridWidth` and `gridY` to a nonnegative integer.

```ts
export function findFirstKpiGridPosition(
  width: number,
  rowSpan: number,
  occupied: readonly KpiGridRectangle[],
): KpiGridPosition {
  const gridWidth = Math.max(3, Math.min(KPI_GRID_COLUMNS, Math.trunc(width)));
  for (let gridY = 0; ; gridY += 1) {
    for (let gridX = 0; gridX <= KPI_GRID_COLUMNS - gridWidth; gridX += 1) {
      const candidate: KpiGridItem = {
        widgetId: '__candidate__', sortOrder: Number.MAX_SAFE_INTEGER,
        gridX, gridY, gridWidth, gridHeight: 1, rowSpan,
      };
      if (occupied.every((item) => !kpiGridItemsOverlap(candidate, item))) return { gridX, gridY };
    }
  }
}
```

- [x] **Step 3: Normalize legacy overlaps without mutating input**

Add `getKpiGridItems(widgets, containerWidth)` to project the full widget list into `KpiGridItem[]` values with row spans derived from the current grid width. Add `normalizeKpiGridLayout(widgets, containerWidth)`. Project each full `KpiWidget` to a `KpiGridItem` and derive its `rowSpan` from width, height, and current grid container width. Sort by `sortOrder`; keep a bounded stored position when its full rectangle is free; otherwise use `findFirstKpiGridPosition` against already placed projections. Return copied original widgets in sort order with only derived `gridX`/`gridY` changed. This derives non-overlapping positions for legacy widgets all stored at `(0, 0)` and performs no network write.

- [x] **Step 4: Add nearest-cell, reorder-pack, and Add Widget tile helpers**

Add `findNearestKpiGridPosition(width, rowSpan, desired, occupied: readonly KpiGridRectangle[])`: enumerate legal cells in increasing Manhattan distance from `desired`, breaking ties by top-to-bottom then left-to-right. Add `packKpiGridLayout(widgets, containerWidth)` to derive current-width row spans and place widgets in `sortOrder` using first-fit, returning copies with packed positions. Add `getKpiAddTilePosition(gridItems: readonly KpiGridItem[])` to return `null` when no in-grid tile is rendered; otherwise reserve a six-column rectangle with `rowSpan = ceil((264 + 17) / 52)` beside the last widget's row when a free half exists, otherwise at the first free position below it. Add `findKpiCreatePosition(gridItems, width, rowSpan, addTilePosition)` that prefers the open half beside the tile when present, then calls first-fit with existing grid items and any tile reserved.

## Task 2: Carry Coordinates Through Frontend Requests and Widget Creation

**Files:**
- Modify: `Front-end/app/src/data/kpiRepository.ts:133-135,159`
- Modify: `Front-end/app/src/pages/KpiAddWidgetDialog.tsx:30-43,220-247`
- Modify: `Front-end/app/src/pages/KpiPage.tsx:1709-1718`

- [x] **Step 1: Add coordinates to the existing request types**

Change the `createKpiWidget` input to include `gridX: number` and `gridY: number`. Add both fields to the `Pick<KpiWidget, ...>` used by `updateKpiWidget`; leave the existing server contract and routes unchanged.

```ts
input: {
  title: string;
  seriesIds: string[];
  gridX: number;
  gridY: number;
  gridWidth: number;
  gridHeight: number;
  periodCount: number;
}
```

- [x] **Step 2: Give the dialog the current normalized widget layout**

Add `layoutWidgets: readonly KpiGridItem[]`, `gridContainerWidth: number`, and `layoutReady: boolean` props to `KpiAddWidgetDialog`. In `KpiPage`, measure the widget-grid host content-box width with `ResizeObserver` and store it; attach the same measurement to the empty-state host so first-widget creation has a real width. Use `ResizeObserverEntry.contentRect.width` so host padding is excluded. Pass `getKpiGridItems(normalizeKpiGridLayout(dashboard.widgets, gridContainerWidth), gridContainerWidth)` for the selected dashboard, and pass an empty list plus `layoutReady=false` when the dialog context is stale, the route has switched, or the dashboard is not loaded. Disable submission until the selected route, loaded dashboard, and dialog context IDs match and the width is positive. Task 3 will move normalization into dashboard state and reuse this width measurement.

- [x] **Step 3: Persist a free initial position when creating a widget**

In the create branch, call the placement helper with the selected `gridWidth`, current widgets, and current Add Widget tile reservation; send the returned `gridX`/`gridY` in `createKpiWidget`. Prefer the open half beside the trailing-row Add Widget tile when the widget fits; otherwise use the first free cell.

```ts
const rowSpan = getKpiGridRowSpan(gridWidth, gridHeight, gridContainerWidth);
const addTilePosition = getKpiAddTilePosition(layoutWidgets);
const position = findKpiCreatePosition(layoutWidgets, gridWidth, rowSpan, addTilePosition);
await createKpiWidget(targetDashboardId, {
  title: widgetTitle.trim(), seriesIds, ...position, gridWidth, gridHeight, periodCount,
});
```

- [x] **Step 4: Keep edit-mode resize inside the grid**

Before the edit branch calls `updateKpiWidget`, recompute the row span at `gridContainerWidth` and run the selected widget through `findNearestKpiGridPosition` with its proposed width, row span, and existing row/column as the preferred position. Send the resolved `gridX`/`gridY` along with `gridWidth`/`gridHeight`. Leave the current position unchanged when it still fits.

## Task 3: Render and Persist Explicit Grid Positions

**Files:**
- Modify: `Front-end/app/src/pages/KpiPage.tsx:369-380,1541-1556,1679-1689`
- Modify: `Front-end/app/src/styles/kpi.css:671-677,1123-1139,1354-1397`

- [x] **Step 1: Normalize positions at dashboard load**

Use the current grid width measured in Task 2 for row-span calculations. In `refreshDashboard`, normalize `next.widgets` with that width before `setDashboard(next)`. When width changes, recalculate `getKpiGridItems` and locally resolve any newly overlapping rectangles without PATCHing saved coordinates. Keep normalized positions in frontend state only; do not PATCH from the load path. The same helper must be used after quiet refreshes so order and positions remain deterministic.

- [x] **Step 2: Render card coordinates and preserve its existing size formula**

On wide layouts, set `.kpi-widget-grid` to `grid-auto-rows: 35px` and `row-gap: 17px`. Replace the current `gridColumn: span N` style with a one-based CSS grid start plus span. Set `gridRow` from zero-based `gridY` and the derived row span:

```tsx
gridColumn: `${widget.gridX + 1} / span ${widget.gridWidth}`,
gridRow: `${widget.gridY + 1} / span ${getKpiGridRowSpan(widget.gridWidth, widget.gridHeight, gridContainerWidth)}`,
```

Keep the existing `--kpi-widget-height-basis`, `--kpi-widget-height-adjustment`, and rendered `height` calculation. At the narrow breakpoint, switch to one column, auto-sized rows, a 12 px row gap, and `grid-row: auto` for widgets and the tile. This preserves stacking without changing saved wide-layout coordinates.

- [x] **Step 3: Place the Add Widget tile from the same layout helper**

Compute its six-column `gridX`/`gridY` using `getKpiAddTilePosition(getKpiGridItems(widgets, gridContainerWidth))` and its span using `ceil((264 + 17) / 52)`. Keep it as a layout reservation when calculating previews and new-widget positions. On screens at or below 700px, override widget and tile coordinates with `grid-column: 1 / -1` and `grid-row: auto`, while keeping stored wide-screen coordinates unchanged.

- [x] **Step 4: Persist derived legacy positions with the next successful layout change**

Keep a per-dashboard snapshot of the last layout returned by the API. Add a reusable persistence helper that compares that snapshot with a candidate layout and PATCHes only widgets whose `gridX`, `gridY`, `gridWidth`, `gridHeight`, or `sortOrder` changed. Use it for the existing reorder path and after create/edit completion to persist derived legacy positions; Tasks 4 and 6 will reuse it for resize and pointer-drop layouts. Do not write derived coordinates from initial or quiet page refreshes.

## Task 4: Make Resize Respect Placement

**Files:**
- Modify: `Front-end/app/src/pages/KpiPage.tsx:1019-1111,1579-1591,1664-1671`
- Reuse: `Front-end/app/src/domain/kpiLayout.ts`

- [x] **Step 1: Resolve width collisions before saving pointer resize**

At the end of `finishWidgetResize`, recompute the row span from the new width/height and current grid width. Retain the current position if its full rectangle remains free; otherwise select the nearest free slot. Include `gridX`/`gridY` with the new width/height in the final update. Keep the existing pixel preview and resize gesture unchanged.

- [x] **Step 2: Use the same resolver for the width menu**

When the Chart width select changes, recompute row span, resolve its destination with the same helper, and send the size and position in one `updateKpiWidget` patch. Do not allow the tile or another widget to be overlapped.

- [x] **Step 3: Preserve placement for height changes when it fits**

Changing only `gridHeight` changes the card height and derived row span. Keep `gridX`, `gridY`, and `sortOrder` when the resized rectangle remains free; otherwise move the resized widget to its nearest free location, respecting the Add Widget tile. Render the new span with fixed row tracks so following items remain collision-free.

## Task 5: Replace Native Drag with Pointer-Based Move Preview

**Files:**
- Modify: `Front-end/app/src/pages/KpiPage.tsx:243-248,1153-1164,1541-1575`
- Modify: `Front-end/app/src/styles/kpi.css:690-695,1395-1401`

- [x] **Step 1: Define the pointer session and preview state**

Add a `KpiWidgetMoveSession` ref containing `widgetId`, `pointerId`, pointer start/current coordinates, card grab offset, original layout snapshot, and whether the activation threshold has been crossed. Add state for the active preview position/layout. Keep resize state separate.

- [x] **Step 2: Start only from draggable blank surfaces**

Attach pointer-down handling to the widget card for administrators. Set a move cursor on draggable blank surfaces; keep controls, chart points/labels, and resize handles' own cursors. Accept only the primary mouse/pen pointer. Ignore targets inside `button`, `a`, `input`, `select`, `textarea`, `summary`, `.kpi-chart-point`, `.kpi-axis-label`, `.kpi-widget-resize-handle`, and active text selections. Keep the existing grip, but route it through the same pointer handler instead of native `draggable`.

- [x] **Step 3: Activate after a small movement threshold**

Do not prevent ordinary clicks or chart hover on pointer-down. Track the pointer globally until it either activates or ends so moving beyond the original card before crossing the threshold still works. Activate after the pointer moves at least 5 CSS pixels. Then capture the pointer, remember the original layout, and render the active card as a fixed floating preview at `clientX - grabOffsetX`, `clientY - grabOffsetY`.

```ts
const MOVE_ACTIVATION_PX = 5;
const moved = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
if (!session.active && moved < MOVE_ACTIVATION_PX) return;
```

- [x] **Step 4: Move the placeholder and animate the live layout**

Use `requestAnimationFrame` to process at most one layout preview per frame. Convert pointer coordinates to the nearest legal row/column using the grid bounds, measured grid column width, the 17 px column gap, and the 52 px row step. For an empty slot, pin the dragged widget there and first-fit the remaining rectangles without collisions. Over another card, call `moveKpiWidget` with the existing “move before target” semantics, then pack the resulting order with the current grid container width. Keep the Add Widget tile reserved during both calculations. Clear the candidate when the pointer is outside the grid and not over a widget so an invalid drop cancels cleanly.

- [x] **Step 5: Remove HTML drag/drop handlers**

Remove `draggable`, `onDragStart`, `onDragEnd`, `onDragOver`, and `onDrop` from widget cards. Route the visible grip, blank-card surface, Escape, `pointerup`, and `pointercancel` through the pointer-session handlers. Escape/cancel restores the original layout snapshot.

## Task 6: Add FLIP Reflow, Save on Drop, and Roll Back on Failure

**Files:**
- Modify: `Front-end/app/src/pages/KpiPage.tsx` (layout state, `reorderWidget`, pointer finish handlers)
- Modify: `Front-end/app/src/styles/kpi.css:1395-1401,1672-1674`

- [x] **Step 1: Animate sibling layout changes with FLIP**

Before replacing the preview layout, record each card's `getBoundingClientRect()` keyed by `data-kpi-widget-id`. In `useLayoutEffect`, measure the new rects, apply the inverse `translate(dx, dy)`, then clear the transform on the next animation frame. Use a 220 ms `cubic-bezier(0.2, 0.8, 0.2, 1)` transition. Keep the dragged preview fixed to the pointer rather than applying FLIP to it.

- [x] **Step 2: Respect reduced motion**

Add a `prefers-reduced-motion: reduce` rule that disables or reduces the sibling transform transition and disables preview scale/lift animation. Keep position feedback through the snapped placeholder.

- [x] **Step 3: Save only on drop**

On a valid `pointerup`, compare the preview layout with the original snapshot and send one existing `updateKpiWidget` PATCH per changed widget, including only changed placement/order fields. Do not send API requests from `pointermove`. After success, replace the local layout with the returned/confirmed dashboard state.

- [x] **Step 4: Restore the saved snapshot after failure**

If any layout PATCH fails, restore the original layout locally, attempt compensating PATCHes for widgets already changed, then call `refreshDashboard` and show the existing dashboard error state. On an invalid drop, Escape, or `pointercancel`, cancel without sending PATCHes.

## Task 7: Verify the Complete Interaction

**Files:**
- Verify: `Front-end/app/src/pages/KpiPage.tsx`
- Verify: `Front-end/app/src/styles/kpi.css`
- Verify: `Front-end/app/src/data/kpiRepository.ts`
- Verify: `Front-end/app/src/pages/KpiAddWidgetDialog.tsx`

- [ ] **Step 1: Run the required static checks**

Run from `Front-end/app`:

```bash
npm run typecheck
```

Expected: exit code 0 and no TypeScript diagnostics.

Run from the repository root:

```bash
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 2: Check blank-surface drag in a browser**

Use a multi-widget dashboard in a wide viewport. Confirm the four-way `move` cursor appears only over draggable blank card surfaces; menus, buttons, chart points/labels, resize handles, and selected text do not start a move. Confirm the card stays put on a click and lifts only after the 5 px threshold.

- [ ] **Step 3: Check live placement and persistence**

Drag through empty positions and across occupied cards. Confirm the pointer preview does not jump, the placeholder snaps to legal positions, and sibling cards move smoothly. Drop in an empty cell and reload: the exact coordinates remain. Drop on a card and reload: the new order remains. Confirm the Add Widget tile never overlaps a card.

- [ ] **Step 4: Check cancellation, failure, resize, and responsive behavior**

Cancel with Escape and `pointercancel`; confirm no layout is saved. Simulate a failed layout PATCH and confirm the original layout returns with the existing error message. Resize into a collision and confirm the widget moves to a free slot. Verify chart tooltips, keyboard focus, narrow-screen touch scrolling, and reduced-motion behavior.

- [ ] **Step 5: Do not run automated test suites unless requested**

The approved spec explicitly limits automated suites. Do not run `npm run test:domain`, backend `pytest`, or add tests unless the user asks.

## Spec Coverage Self-Review

- Four-way cursor, blank-surface start, ignored controls/points/resize handles: Tasks 5 and 7.
- Floating pointer preview, stable grab offset, snapped placeholder: Task 5.
- Smooth sibling reflow with no overlap: Tasks 1, 5, 6, and 7.
- Exact empty-cell persistence and occupied-card reorder: Tasks 1, 3, 5, and 6.
- Create/resize collision handling and legacy `(0, 0)` normalization: Tasks 1–4.
- Cancel/failure rollback and save-on-drop only: Tasks 5–7.
- Chart interactions, narrow layout/scrolling, and reduced motion: Tasks 5–7.
- No database migration or new dependency: Architecture and Tasks 1–2.

## Self-Review Notes

- Placeholder scan: no TODO/TBD or unresolved implementation markers.
- Type consistency: `KpiGridItem`, `KpiGridPosition`, `KpiGridRectangle`, `kpiGridItemsOverlap`, `getKpiGridItems`, `findFirstKpiGridPosition`, `findNearestKpiGridPosition`, `normalizeKpiGridLayout(widgets, containerWidth)`, `packKpiGridLayout(widgets, containerWidth)`, `getKpiAddTilePosition`, and `findKpiCreatePosition` are defined in Task 1 before their use.
- Coordinate model: `gridY`/`rowSpan` are logical row units. `gridHeight` continues to use the current responsive pixel formula with the existing 250 px minimum; `getKpiGridRowSpan` converts its rendered height at the current container width into a collision-safe number of 52 px row steps.
