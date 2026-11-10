# Responsive KPI widget grid and smooth pointer dragging

**Status:** Draft for user review — interaction and hybrid placement design
**Project:** KPI Dashboards
**Related context:** `../../../README.md`, `../../../Front-end/app/src/pages/KpiPage.tsx`, `../../../Front-end/app/src/domain/kpi.ts`

## 1. Goal

Let an administrator move KPI widgets from blank card surfaces with a four-way move cursor. While a widget follows the pointer, show a live grid preview and smoothly animate the other widgets into their new positions. Dropping in empty grid space saves that exact position; dropping on another widget changes the order.

## 2. Current behavior

- The desktop dashboard uses 12 CSS grid columns. Width and height control the widget span and rendered height.
- The frontend sorts widgets by `sortOrder` and lets CSS auto-place them. It does not use `gridX` or `gridY`.
- The API and database already accept and return `gridX` and `gridY`; the frontend model receives these values, but create/update request types currently do not send them.
- Native HTML drag starts only on the small grip. Dropping on another card changes order; empty grid space is not a drop target.
- The current interaction does not show a live insertion preview or animate sibling movement during the drag.
- At viewport widths up to 700px, cards stack at full width.

## 3. Proposed behavior

### Drag start and preview

- Administrators can start a move by pressing a blank area of a widget card. Show the four-direction `move` cursor over draggable blank surfaces. Keep the existing grip as an additional visible drag affordance.
- Do not start a move from menus, buttons, form controls, chart points or axis labels, text selection, or resize handles. Chart hover and keyboard focus remain usable.
- Use mouse/pen Pointer Events with a small activation threshold so ordinary clicks and chart hover remain unaffected. Do not capture touch scrolling on the narrow layout. No new drag-and-drop dependency is needed.
- Once active, lift a floating preview at the pointer while preserving the grab offset. Remove it from the grid flow and move a placeholder to the candidate position.
- As the pointer crosses valid positions, update the placeholder and repack remaining widgets without overlaps. Animate every changed card position with FLIP-style transforms. Update the preview at most once per animation frame; do not update the backend during pointer movement.

### Drop behavior

- Dropping over a valid empty grid location saves the moved widget's exact `gridX` and `gridY`; persist any other positions changed by collision-free repacking through the existing API.
- Dropping over another widget uses the existing reorder behavior (move before the hovered widget) and saves the resulting order and packed positions. Do not create overlapping positions.
- Dropping on an invalid area, pressing Escape, or receiving `pointercancel` restores the last saved layout. If persistence fails, restore saved positions and use the existing dashboard error handling.
- Save the final position/order once on drop. Keep resize gestures and dimensions independent from move gestures.

### Placement and responsive behavior

- Keep the 12-column coordinate system on wide layouts. Find the nearest valid empty location for the dragged widget, respecting its width and height; show the snapped preview there.
- On creation, place the new widget in the first fitting empty location, preferring space beside the Add Widget tile in its trailing row, then scanning top-to-bottom and left-to-right. The Add Widget tile participates in collision checks.
- If resizing a widget would overlap another widget or the Add Widget tile, move the resized widget to the nearest free location that fits. Keep its current location when it still fits.
- Existing widgets whose persisted positions overlap at the default `(0, 0)` receive derived non-overlapping positions based on current `sortOrder` and width. Do not persist those derived coordinates on page load; persist them with the next successful layout change.
- Preserve the current single-column narrow layout and saved wide-screen positions when moving between breakpoints.
- Respect `prefers-reduced-motion` by suppressing or shortening sibling transitions.

## 4. Data and implementation boundaries

- Use existing persisted `gridX`, `gridY`, `gridWidth`, and `gridHeight`; no database migration is expected.
- Add `gridX` and `gridY` to the frontend create/update request types and send coordinates through the existing API.
- Keep collision detection, legacy-position derivation, packing, and nearest-free placement in a small pure layout helper. `KpiPage` owns pointer interaction, preview, animation coordination, and persistence.
- Preserve existing widget content, values, resize behavior, and dashboard error handling.

## 5. Acceptance checks

1. On an administrator view, blank widget surfaces show a four-way move cursor; menus, buttons, form controls, chart points, and resize handles do not start a move.
2. A press-and-drag lifts the selected widget at the pointer and shows its snapped placeholder without a positional jump.
3. Other widgets smoothly reflow as the placeholder moves, with no overlap; the dragged widget follows the pointer.
4. Dropping in an empty grid area persists the exact position after reload and does not overlap widgets or the Add Widget tile.
5. Dropping on another card preserves the current reorder behavior and persists the resulting order.
6. Creating or resizing a widget never produces an overlap; existing position defaults are derived without writes on page load.
7. Escape, pointer cancellation, or a failed save restores the last saved layout.
8. Resize, chart hover/tooltips, and narrow-screen touch scrolling continue to work.
9. Reduced-motion settings avoid long movement animations.

## 6. Verification

- Run the frontend TypeScript check and `git diff --check`.
- In a browser, check drag from blank card space, live movement on a multi-widget dashboard, exact empty-cell placement, occupied-card reorder, persistence after reload, cancelled/failed drops, resize, chart tooltips, and narrow-screen behavior.
- Do not run the automated test suites unless the user asks for them.
