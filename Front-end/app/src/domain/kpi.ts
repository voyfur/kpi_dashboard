export type KpiSeriesConfig = { cadence: string; unit: string };
export type KpiDraftStatus = 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';
export type KpiSeriesValidation = 'series-count' | 'cadence' | 'units';
export type KpiSortableWidget = { widgetId: string; sortOrder: number };

export function canApplyServerKpiPointUpdate(status?: KpiDraftStatus): boolean {
  return status === undefined || status === 'saved';
}

export function moveKpiWidget<T extends KpiSortableWidget>(
  widgets: readonly T[],
  draggedId: string,
  targetId: string,
): T[] | null {
  const ordered = [...widgets].sort((left, right) => left.sortOrder - right.sortOrder);
  const from = ordered.findIndex((widget) => widget.widgetId === draggedId);
  const to = ordered.findIndex((widget) => widget.widgetId === targetId);
  if (from < 0 || to < 0 || from === to) return null;
  const [moved] = ordered.splice(from, 1);
  ordered.splice(to, 0, moved);
  return ordered.map((widget, index) => ({ ...widget, sortOrder: index }));
}

export function getNumericExtent(values: readonly (string | null)[]): [number, number] | null {
  const numbers = values
    .map(parseKpiNumber)
    .filter((value): value is number => value !== null);
  if (numbers.length === 0) return null;

  let minimum = Math.min(...numbers);
  let maximum = Math.max(...numbers);
  if (minimum === maximum) {
    const padding = Math.abs(minimum) * 0.05 || 1;
    minimum -= padding;
    maximum += padding;
  }
  return [minimum, maximum];
}

export function splitKpiLineSegments(
  points: readonly { value: string | null }[],
): number[][] {
  const segments: number[][] = [];
  let current: number[] = [];
  points.forEach((point, index) => {
    if (parseKpiNumber(point.value) === null) {
      if (current.length > 0) segments.push(current);
      current = [];
      return;
    }
    current.push(index);
  });
  if (current.length > 0) segments.push(current);
  return segments;
}

export function validateKpiSeries(series: readonly KpiSeriesConfig[]): KpiSeriesValidation | null {
  if (series.length < 2 || series.length > 4) return 'series-count';
  if (new Set(series.map((item) => item.cadence)).size !== 1) return 'cadence';
  if (new Set(series.map((item) => item.unit)).size > 2) return 'units';
  return null;
}

export function parseKpiNumber(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
