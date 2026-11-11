import { requestJson } from './api.ts';

export type KpiCadence = 'hour' | 'day' | 'week' | 'month' | 'year';
export type KpiDepartmentColor = 'blue' | 'teal' | 'green' | 'amber' | 'rose' | 'violet';
export type KpiDepartment = {
  departmentId: string;
  name: string;
  emoji: string | null;
  color: KpiDepartmentColor | null;
  sortOrder: number;
  parentDepartmentId: string | null;
  dashboards: KpiDashboardSummary[];
};
export type KpiDashboardSummary = {
  dashboardId: string;
  departmentId: string;
  name: string;
  description: string | null;
  sortOrder: number;
};
export type KpiDefinition = {
  definitionId: string;
  departmentId: string;
  name: string;
  description: string | null;
  unit: string;
  precision: number;
  cadence: KpiCadence;
  series: { seriesId: string; label: string }[];
};
export type KpiPoint = {
  periodStart: string;
  value: string | null;
  comment: string | null;
  updatedAt: string | null;
  isCurrentPeriod: boolean;
};
export type KpiWidgetSeries = {
  seriesId: string;
  definitionId: string;
  name: string;
  unit: string;
  precision: number;
  cadence: KpiCadence;
  label: string;
  axisSide: 'left' | 'right';
  color: string | null;
  points: KpiPoint[];
};
export type KpiWidget = {
  widgetId: string;
  dashboardId: string;
  title: string;
  description: string | null;
  sortOrder: number;
  gridX: number;
  gridY: number;
  gridWidth: number;
  gridHeight: number;
  periodCount: number;
  showLinearTrend: boolean;
  showMovingAverage: boolean;
  periods: string[];
  series: KpiWidgetSeries[];
};
export type KpiDashboard = KpiDashboardSummary & {
  rangeStart: string | null;
  rangeEnd: string | null;
  department: Pick<KpiDepartment, 'departmentId' | 'name' | 'sortOrder'>;
  widgets: KpiWidget[];
};

const root = '/api/v1/kpi';

export function listKpiDepartments(): Promise<KpiDepartment[]> {
  return requestJson(`${root}/departments`, 'GET') as Promise<KpiDepartment[]>;
}

export function createKpiDepartment(
  name: string,
  parentDepartmentId: string | null = null,
): Promise<Omit<KpiDepartment, 'dashboards'>> {
  return requestJson(`${root}/departments`, 'POST', { name, parentDepartmentId }) as Promise<Omit<KpiDepartment, 'dashboards'>>;
}

export function updateKpiDepartment(
  departmentId: string,
  patch: { name?: string; emoji?: string | null; color?: KpiDepartmentColor | null; sortOrder?: number; parentDepartmentId?: string | null },
): Promise<Omit<KpiDepartment, 'dashboards'>> {
  return requestJson(`${root}/departments/${departmentId}`, 'PATCH', patch) as Promise<Omit<KpiDepartment, 'dashboards'>>;
}

export function deleteKpiDepartment(departmentId: string, confirmationName: string): Promise<void> {
  return requestJson(`${root}/departments/${departmentId}`, 'DELETE', { confirmationName }) as Promise<void>;
}

export function deleteKpiDashboard(dashboardId: string): Promise<void> {
  return requestJson(`${root}/dashboards/${dashboardId}`, 'DELETE', {}) as Promise<void>;
}

export function createKpiDashboard(departmentId: string, name: string): Promise<KpiDashboardSummary> {
  return requestJson(`${root}/departments/${departmentId}/dashboards`, 'POST', { name }) as Promise<KpiDashboardSummary>;
}

export function loadKpiDefinitions(departmentId: string): Promise<KpiDefinition[]> {
  return requestJson(`${root}/departments/${departmentId}/definitions`, 'GET') as Promise<KpiDefinition[]>;
}

export function createKpiDefinition(
  departmentId: string,
  input: { name: string; description?: string | null; unit: string; precision: number; cadence: KpiCadence; seriesLabels: string[] },
): Promise<KpiDefinition> {
  return requestJson(`${root}/departments/${departmentId}/definitions`, 'POST', input) as Promise<KpiDefinition>;
}

export function updateKpiDefinition(
  definitionId: string,
  patch: { name?: string; description?: string | null; unit?: string; precision?: number; cadence?: KpiCadence },
): Promise<KpiDefinition> {
  return requestJson(`${root}/definitions/${definitionId}`, 'PATCH', patch) as Promise<KpiDefinition>;
}

export function updateKpiSeries(seriesId: string, label: string): Promise<{ seriesId: string; definitionId: string; label: string }> {
  return requestJson(`${root}/series/${seriesId}`, 'PATCH', { label }) as Promise<{ seriesId: string; definitionId: string; label: string }>;
}

export function createKpiSeries(definitionId: string, label: string): Promise<{ seriesId: string; definitionId: string; label: string }> {
  return requestJson(`${root}/definitions/${definitionId}/series`, 'POST', { label }) as Promise<{ seriesId: string; definitionId: string; label: string }>;
}

export function createKpiWidget(
  dashboardId: string,
  input: {
    title: string;
    description?: string | null;
    seriesIds: string[];
    gridX: number;
    gridY: number;
    gridWidth: number;
    gridHeight: number;
    periodCount: number;
    showLinearTrend?: boolean;
    showMovingAverage?: boolean;
    series?: { seriesId: string; axisSide: 'left' | 'right' }[];
    seriesColors?: Record<string, string | null>;
  },
): Promise<KpiWidget> {
  return requestJson(`${root}/dashboards/${dashboardId}/widgets`, 'POST', input) as Promise<KpiWidget>;
}

export function loadKpiSeriesPreview(
  departmentId: string,
  seriesIds: string[],
  periodCount: number,
): Promise<KpiWidgetSeries[]> {
  const query = new URLSearchParams({ periodCount: String(periodCount) });
  seriesIds.forEach((seriesId) => query.append('seriesIds', seriesId));
  return requestJson(`${root}/departments/${departmentId}/series-preview?${query}`, 'GET') as Promise<KpiWidgetSeries[]>;
}

export function loadKpiDashboard(dashboardId: string): Promise<KpiDashboard> {
  return requestJson(`${root}/dashboards/${dashboardId}`, 'GET') as Promise<KpiDashboard>;
}

export function updateKpiDashboard(
  dashboardId: string,
  patch: { rangeStart?: string | null; rangeEnd?: string | null; name?: string; description?: string | null },
): Promise<unknown> {
  return requestJson(`${root}/dashboards/${dashboardId}`, 'PATCH', patch);
}

export function updateKpiWidget(widgetId: string, patch: Partial<Pick<KpiWidget, 'title' | 'description' | 'sortOrder' | 'gridX' | 'gridY' | 'gridWidth' | 'gridHeight' | 'periodCount' | 'showLinearTrend' | 'showMovingAverage'>> & { seriesIds?: string[]; seriesColors?: Record<string, string | null> }): Promise<KpiWidget> {
  return requestJson(`${root}/widgets/${widgetId}`, 'PATCH', patch) as Promise<KpiWidget>;
}

export function deleteKpiWidget(widgetId: string): Promise<void> {
  return requestJson(`${root}/widgets/${widgetId}`, 'DELETE', {}) as Promise<void>;
}

export function writeKpiValue(
  seriesId: string,
  periodStart: string,
  input: { value: string; comment: string | null; expectedUpdatedAt: string | null },
): Promise<{ seriesId: string; periodStart: string; value: string; comment: string | null; updatedAt: string }> {
  return requestJson(`${root}/series/${seriesId}/values/${encodeURIComponent(periodStart)}`, 'PUT', input) as Promise<{ seriesId: string; periodStart: string; value: string; comment: string | null; updatedAt: string }>;
}

export function deleteKpiValue(seriesId: string, periodStart: string, expectedUpdatedAt: string): Promise<void> {
  return requestJson(`${root}/series/${seriesId}/values/${encodeURIComponent(periodStart)}`, 'DELETE', { expectedUpdatedAt }) as Promise<void>;
}
