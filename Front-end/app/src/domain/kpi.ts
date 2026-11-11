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

export type KpiLinearTrendSegment = {
  startIndex: number;
  endIndex: number;
  startValue: number;
  endValue: number;
};

export function getLinearTrendSegment(values: readonly (string | null)[]): KpiLinearTrendSegment | null {
  const observations = values.flatMap((value, index) => {
    const numericValue = parseKpiNumber(value);
    return numericValue === null ? [] : [{ index, value: numericValue }];
  });
  if (observations.length < 2) return null;

  const meanIndex = observations.reduce((total, point) => total + point.index, 0) / observations.length;
  const meanValue = observations.reduce((total, point) => total + point.value, 0) / observations.length;
  const denominator = observations.reduce((total, point) => total + (point.index - meanIndex) ** 2, 0);
  const slope = observations.reduce(
    (total, point) => total + (point.index - meanIndex) * (point.value - meanValue),
    0,
  ) / denominator;
  const intercept = meanValue - slope * meanIndex;
  const maximumIndex = values.length - 1;
  const minimumSpan = maximumIndex / 2;
  let startIndex = Math.max(0, observations[0].index - 0.5);
  let endIndex = Math.min(maximumIndex, observations[observations.length - 1].index + 0.5);

  if (endIndex - startIndex < minimumSpan) {
    const center = (startIndex + endIndex) / 2;
    startIndex = center - minimumSpan / 2;
    endIndex = center + minimumSpan / 2;
    if (startIndex < 0) {
      endIndex -= startIndex;
      startIndex = 0;
    }
    if (endIndex > maximumIndex) {
      startIndex -= endIndex - maximumIndex;
      endIndex = maximumIndex;
    }
  }

  return {
    startIndex,
    endIndex,
    startValue: intercept + slope * startIndex,
    endValue: intercept + slope * endIndex,
  };
}

export function getMovingAverageValues(values: readonly (string | null)[]): (number | null)[] {
  const numericValues = values.map(parseKpiNumber);
  return values.map((_, index) => {
    if (index < 2) return null;
    const window = numericValues.slice(index - 2, index + 1);
    const [first, second, third] = window;
    if (first === null || second === null || third === null) return null;
    return (first + second + third) / 3;
  });
}

export function validateKpiSeries(series: readonly KpiSeriesConfig[]): KpiSeriesValidation | null {
  if (series.length < 1 || series.length > 10) return 'series-count';
  if (new Set(series.map((item) => item.cadence)).size !== 1) return 'cadence';
  if (new Set(series.map((item) => item.unit)).size > 2) return 'units';
  return null;
}

export function parseKpiNumber(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
