import type { KpiWidget } from '../data/kpiRepository.ts';

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

function clampWidth(width: number): number {
  return Math.max(3, Math.min(KPI_GRID_COLUMNS, Math.trunc(width)));
}

export function getKpiGridRowSpan(gridWidth: number, gridHeight: number, containerWidth: number): number {
  const renderedHeight = Math.max(
    250,
    204 + (gridWidth / KPI_GRID_COLUMNS * 0.322 * containerWidth) + (gridHeight - 4) * KPI_GRID_ROW_STEP_PX,
  );
  return Math.max(1, Math.ceil((renderedHeight + KPI_GRID_ROW_GAP_PX) / KPI_GRID_ROW_STEP_PX));
}

export function clampKpiGridPosition(item: Pick<KpiGridItem, 'gridX' | 'gridY' | 'gridWidth'>): KpiGridPosition {
  const width = clampWidth(item.gridWidth);
  return {
    gridX: Math.max(0, Math.min(KPI_GRID_COLUMNS - width, Math.trunc(item.gridX))),
    gridY: Math.max(0, Math.trunc(item.gridY)),
  };
}

export function getKpiGridItems(widgets: readonly KpiWidget[], containerWidth: number): KpiGridItem[] {
  return [...widgets]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((widget) => ({
      widgetId: widget.widgetId,
      sortOrder: widget.sortOrder,
      gridX: widget.gridX,
      gridY: widget.gridY,
      gridWidth: clampWidth(widget.gridWidth),
      gridHeight: widget.gridHeight,
      rowSpan: getKpiGridRowSpan(clampWidth(widget.gridWidth), widget.gridHeight, containerWidth),
    }));
}

export function kpiGridItemsOverlap(
  left: KpiGridRectangle,
  right: KpiGridRectangle,
): boolean {
  return left.gridX < right.gridX + right.gridWidth
    && right.gridX < left.gridX + left.gridWidth
    && left.gridY < right.gridY + right.rowSpan
    && right.gridY < left.gridY + left.rowSpan;
}

function positionItem(
  gridX: number,
  gridY: number,
  gridWidth: number,
  rowSpan: number,
): Pick<KpiGridItem, 'gridX' | 'gridY' | 'gridWidth' | 'rowSpan'> {
  return { gridX, gridY, gridWidth, rowSpan };
}

export function findFirstKpiGridPosition(
  width: number,
  rowSpan: number,
  occupied: readonly KpiGridRectangle[],
): KpiGridPosition {
  const boundedWidth = clampWidth(width);
  for (let gridY = 0; ; gridY += 1) {
    for (let gridX = 0; gridX <= KPI_GRID_COLUMNS - boundedWidth; gridX += 1) {
      const candidate = positionItem(gridX, gridY, boundedWidth, Math.max(1, Math.trunc(rowSpan)));
      if (!occupied.some((item) => kpiGridItemsOverlap(candidate, item))) return { gridX, gridY };
    }
  }
}

export function normalizeKpiGridLayout(widgets: readonly KpiWidget[], containerWidth: number): KpiWidget[] {
  const ordered = [...widgets].sort((a, b) => a.sortOrder - b.sortOrder);
  const placed: KpiGridItem[] = [];
  return ordered.map((widget) => {
    const item: KpiGridItem = {
      widgetId: widget.widgetId,
      sortOrder: widget.sortOrder,
      gridX: widget.gridX,
      gridY: widget.gridY,
      gridWidth: clampWidth(widget.gridWidth),
      gridHeight: widget.gridHeight,
      rowSpan: getKpiGridRowSpan(clampWidth(widget.gridWidth), widget.gridHeight, containerWidth),
    };
    const bounded = { ...item, ...clampKpiGridPosition(item) };
    const position = placed.some((other) => kpiGridItemsOverlap(bounded, other))
      ? findFirstKpiGridPosition(bounded.gridWidth, bounded.rowSpan, placed)
      : { gridX: bounded.gridX, gridY: bounded.gridY };
    const normalized = { ...widget, ...position };
    placed.push({ ...bounded, ...position });
    return normalized;
  });
}

export function findNearestKpiGridPosition(
  width: number,
  rowSpan: number,
  desired: KpiGridPosition,
  occupied: readonly KpiGridRectangle[],
): KpiGridPosition {
  const boundedWidth = clampWidth(width);
  const maxX = KPI_GRID_COLUMNS - boundedWidth;
  const targetX = Math.max(0, Math.min(maxX, Math.trunc(desired.gridX)));
  const targetY = Math.max(0, Math.trunc(desired.gridY));
  for (let distance = 0; ; distance += 1) {
    for (let gridY = Math.max(0, targetY - distance); gridY <= targetY + distance; gridY += 1) {
      const remaining = distance - Math.abs(gridY - targetY);
      if (remaining < 0) continue;
      const xs = remaining === 0 ? [targetX] : [targetX - remaining, targetX + remaining];
      for (const gridX of xs) {
        if (gridX < 0 || gridX > maxX) continue;
        const candidate = positionItem(gridX, gridY, boundedWidth, Math.max(1, Math.trunc(rowSpan)));
        if (!occupied.some((item) => kpiGridItemsOverlap(candidate, item))) return { gridX, gridY };
      }
    }
  }
}

export function packKpiGridLayout<T extends KpiWidget>(widgets: readonly T[], containerWidth: number): T[] {
  const occupied: KpiGridItem[] = [];
  const orderedWidgets = [...widgets].sort((a, b) => a.sortOrder - b.sortOrder);
  const items = getKpiGridItems(orderedWidgets, containerWidth);
  return items.map((item, index) => {
    const widget = orderedWidgets[index];
    const width = item.gridWidth;
    const rowSpan = item.rowSpan;
    const position = findFirstKpiGridPosition(width, rowSpan, occupied);
    occupied.push({
      widgetId: widget.widgetId, sortOrder: widget.sortOrder, ...position,
      gridWidth: width, gridHeight: widget.gridHeight, rowSpan,
    });
    return { ...widget, ...position };
  });
}

const KPI_ADD_TILE_WIDTH = 6;
const KPI_ADD_TILE_ROW_SPAN = Math.ceil((264 + KPI_GRID_ROW_GAP_PX) / KPI_GRID_ROW_STEP_PX);

export function getKpiAddTilePosition(widgets: readonly KpiGridItem[]): KpiGridPosition | null {
  if (widgets.length === 0) return null;
  const ordered = [...widgets].sort((a, b) => a.sortOrder - b.sortOrder);
  const last = ordered[ordered.length - 1];
  const occupied: KpiGridItem[] = ordered;
  for (const gridX of [0, KPI_ADD_TILE_WIDTH]) {
    const candidate = positionItem(gridX, last.gridY, KPI_ADD_TILE_WIDTH, KPI_ADD_TILE_ROW_SPAN);
    if (!occupied.some((item) => kpiGridItemsOverlap(candidate, item))) return { gridX, gridY: last.gridY };
  }
  for (let gridY = last.gridY + last.rowSpan; ; gridY += 1) {
    for (let gridX = 0; gridX <= KPI_GRID_COLUMNS - KPI_ADD_TILE_WIDTH; gridX += 1) {
      const candidate = positionItem(gridX, gridY, KPI_ADD_TILE_WIDTH, KPI_ADD_TILE_ROW_SPAN);
      if (!occupied.some((item) => kpiGridItemsOverlap(candidate, item))) return { gridX, gridY };
    }
  }
}

export function findKpiCreatePosition(
  widgets: readonly KpiGridItem[],
  width: number,
  rowSpan: number,
  addTilePosition: KpiGridPosition | null,
): KpiGridPosition {
  const boundedWidth = clampWidth(width);
  const occupied: KpiGridItem[] = [...widgets];
  if (addTilePosition && boundedWidth <= KPI_ADD_TILE_WIDTH) {
    const oppositeX = addTilePosition.gridX === 0 ? KPI_ADD_TILE_WIDTH : 0;
    const adjacent = positionItem(oppositeX, addTilePosition.gridY, boundedWidth, rowSpan);
    if (!occupied.some((item) => kpiGridItemsOverlap(adjacent, item))
      && !kpiGridItemsOverlap(adjacent, positionItem(addTilePosition.gridX, addTilePosition.gridY, KPI_ADD_TILE_WIDTH, KPI_ADD_TILE_ROW_SPAN))) {
      return { gridX: oppositeX, gridY: addTilePosition.gridY };
    }
  }
  const reserved = addTilePosition
    ? [...occupied, positionItem(addTilePosition.gridX, addTilePosition.gridY, KPI_ADD_TILE_WIDTH, KPI_ADD_TILE_ROW_SPAN)]
    : occupied;
  return findFirstKpiGridPosition(boundedWidth, rowSpan, reserved);
}
