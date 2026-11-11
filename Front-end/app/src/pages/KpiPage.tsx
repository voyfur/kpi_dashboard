import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ApiRequestError } from '../data/api';
import { useAuth } from '../data/AuthContext';
import {
  createKpiDepartment,
  createKpiWidget,
  deleteKpiDashboard,
  deleteKpiDepartment,
  deleteKpiValue,
  deleteKpiWidget,
  listKpiDepartments,
  loadKpiDashboard,
  loadKpiDefinitions,
  updateKpiDashboard,
  updateKpiDepartment,
  updateKpiWidget,
  writeKpiValue,
  type KpiCadence,
  type KpiDashboard,
  type KpiDashboardSummary,
  type KpiDefinition,
  type KpiDepartment,
  type KpiDepartmentColor,
  type KpiPoint,
  type KpiWidget,
  type KpiWidgetSeries,
} from '../data/kpiRepository';
import { canApplyServerKpiPointUpdate, getLinearTrendSegment, getMovingAverageValues, getNumericExtent, moveKpiWidget, parseKpiNumber, splitKpiLineSegments, validateKpiSeries, type KpiDraftStatus } from '../domain/kpi';
import { findFirstKpiGridPosition, findKpiCreatePosition, findNearestKpiGridPosition, getKpiAddTilePosition, getKpiGridItems, getKpiGridRowSpan, kpiGridItemsOverlap, KPI_GRID_ROW_GAP_PX, KPI_GRID_ROW_STEP_PX, normalizeKpiGridLayout, packKpiGridLayout } from '../domain/kpiLayout';
import { useLocale } from '../i18n/LocaleProvider';
import { getKpiSeriesValidationMessage, type Messages } from '../i18n/messages';
import { KpiAddWidgetDialog, type KpiAddWidgetDialogContext } from './KpiAddWidgetDialog';
import { KpiCreateDashboardDialog } from './KpiCreateDashboardDialog';

type SaveState = KpiDraftStatus;
type CellDraft = {
  value: string;
  comment: string;
  expectedUpdatedAt: string | null;
  latestServerValue?: string | null;
  latestServerComment?: string | null;
  status: SaveState;
  revision: number;
};
type SeriesChoice = {
  seriesId: string;
  label: string;
  definitionName: string;
  cadence: KpiCadence;
  unit: string;
};
type KpiValueUpdateMessage = {
  sourceId: string;
  seriesId: string;
  periodStart: string;
  value: string | null;
  comment: string | null;
  updatedAt: string | null;
};
type KpiWidgetResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
type KpiWidgetResizeDraft = { widgetId: string; gridWidth: number; gridHeight: number; pixelWidth: number; pixelHeight: number };
type KpiWidgetResizeDrag = KpiWidgetResizeDraft & {
  pointerId: number;
  startX: number;
  startY: number;
  startGridWidth: number;
  startGridHeight: number;
  columnStep: number;
  containerWidth: number;
  startWidthPx: number;
  startHeightPx: number;
  direction: KpiWidgetResizeDirection;
  element: HTMLElement;
  initialStyle: { width: string; height: string; transform: string; gridColumn: string };
};
type KpiWidgetMoveCandidate =
  | { kind: 'grid'; position: Pick<KpiWidget, 'gridX' | 'gridY'> }
  | { kind: 'before'; targetWidgetId: string }
  | null;
type KpiWidgetMovePreview = {
  widgetId: string;
  layout: KpiWidget[];
  candidate: KpiWidgetMoveCandidate;
  left: number;
  top: number;
  width: number;
  height: number;
  addTilePosition: Pick<KpiWidget, 'gridX' | 'gridY'> | null;
  active: boolean;
};
type KpiWidgetMoveSession = {
  widgetId: string;
  dashboardId: string;
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  grabOffsetX: number;
  grabOffsetY: number;
  width: number;
  height: number;
  originalLayout: KpiWidget[];
  originalPreview: KpiWidgetMovePreview | null;
  addTilePosition: Pick<KpiWidget, 'gridX' | 'gridY'> | null;
  element: HTMLElement;
  active: boolean;
  frameId: number | null;
  cleanup?: () => void;
};

function cleanupKpiWidgetMoveSession(session: KpiWidgetMoveSession) {
  if (session.frameId !== null) {
    window.cancelAnimationFrame(session.frameId);
    session.frameId = null;
  }
  session.cleanup?.();
  if (session.element.hasPointerCapture(session.pointerId)) session.element.releasePointerCapture(session.pointerId);
}

const risingLineColor = '#28866d';
const fallingLineColor = '#cf4545';
const neutralTrendColor = '#66788a';
const departmentColorValues: Record<KpiDepartmentColor, string> = {
  blue: '#3478b7',
  teal: '#138a83',
  green: '#4a8a52',
  amber: '#bf7b22',
  rose: '#c34f6a',
  violet: '#7955ad',
};
const departmentEmojiOptions = ['📊', '🚀', '💰', '🎯', '👥', '⚙️', '🏭', '🌸', '🌼', '🌷', '🪴'];
const cellKey = (seriesId: string, period: string) => `${seriesId}:${period}`;
const KPI_WIDGET_MOVE_ACTIVATION_PX = 5;

type DepartmentTreeNode = KpiDepartment & { children: DepartmentTreeNode[] };
type KpiWidgetLayoutSnapshot = Pick<KpiWidget, 'widgetId' | 'gridX' | 'gridY' | 'gridWidth' | 'gridHeight' | 'sortOrder'>;
type KpiWidgetLayoutPatch = Partial<Pick<KpiWidget, 'gridX' | 'gridY' | 'gridWidth' | 'gridHeight' | 'sortOrder'>>;
type KpiWidgetLayoutCandidateFactory = (
  currentLayouts: ReadonlyMap<string, KpiWidgetLayoutSnapshot>,
) => readonly KpiWidget[] | null;
type KpiWidgetLayoutPersistOptions = {
  onSuccess?: (widgets: readonly KpiWidget[]) => void;
  onFailure?: {
    rollbackLocal: () => void;
    refreshAfterCompensation: () => Promise<void>;
  };
};

type KpiWidgetFlipInlineStyles = { transform: string; transition: string };

function snapshotKpiWidgetLayouts(widgets: readonly KpiWidget[]): Map<string, KpiWidgetLayoutSnapshot> {
  return new Map(widgets.map((widget) => [widget.widgetId, {
    widgetId: widget.widgetId,
    gridX: widget.gridX,
    gridY: widget.gridY,
    gridWidth: widget.gridWidth,
    gridHeight: widget.gridHeight,
    sortOrder: widget.sortOrder,
  }]));
}

function haveSameKpiWidgetLayout(left: readonly KpiWidget[], right: readonly KpiWidget[]): boolean {
  if (left.length !== right.length) return false;
  const previous = new Map(left.map((widget) => [widget.widgetId, widget]));
  return right.every((widget) => {
    const prior = previous.get(widget.widgetId);
    return Boolean(prior
      && prior.gridX === widget.gridX
      && prior.gridY === widget.gridY
      && prior.gridWidth === widget.gridWidth
      && prior.gridHeight === widget.gridHeight
      && prior.sortOrder === widget.sortOrder);
  });
}

function cancelKpiWidgetFlipStyles(styles: Map<HTMLElement, KpiWidgetFlipInlineStyles>) {
  styles.forEach((original, element) => {
    element.style.transition = 'none';
    element.style.transform = original.transform;
    element.getBoundingClientRect();
    element.style.transition = original.transition;
  });
  styles.clear();
}

function finishKpiWidgetFlipStyles(styles: Map<HTMLElement, KpiWidgetFlipInlineStyles>) {
  styles.forEach((original, element) => {
    element.style.transition = original.transition;
    element.style.transform = original.transform;
  });
  styles.clear();
}

function getKpiAddTileReservation(position: Pick<KpiWidget, 'gridX' | 'gridY'> | null) {
  return position ? {
    gridX: position.gridX,
    gridY: position.gridY,
    gridWidth: 6,
    rowSpan: Math.ceil((264 + KPI_GRID_ROW_GAP_PX) / KPI_GRID_ROW_STEP_PX),
  } : null;
}

function packKpiPreviewLayout(
  widgets: readonly KpiWidget[],
  containerWidth: number,
  addTilePosition: Pick<KpiWidget, 'gridX' | 'gridY'> | null,
): KpiWidget[] {
  const packed = packKpiGridLayout(widgets, containerWidth);
  const tile = getKpiAddTileReservation(addTilePosition);
  if (!tile || !getKpiGridItems(packed, containerWidth).some((item) => kpiGridItemsOverlap(item, tile))) return packed;

  const occupied: Array<{ gridX: number; gridY: number; gridWidth: number; rowSpan: number }> = [tile];
  return [...packed].sort((left, right) => left.sortOrder - right.sortOrder).map((widget) => {
    const rowSpan = getKpiGridRowSpan(widget.gridWidth, widget.gridHeight, containerWidth);
    const position = findFirstKpiGridPosition(widget.gridWidth, rowSpan, occupied);
    occupied.push({ ...position, gridWidth: widget.gridWidth, rowSpan });
    return { ...widget, ...position };
  });
}

function placeKpiWidgetAtGridPosition(
  widgets: readonly KpiWidget[],
  widgetId: string,
  desired: Pick<KpiWidget, 'gridX' | 'gridY'>,
  containerWidth: number,
  addTilePosition: Pick<KpiWidget, 'gridX' | 'gridY'> | null,
): { layout: KpiWidget[]; position: Pick<KpiWidget, 'gridX' | 'gridY'> } | null {
  const dragged = widgets.find((widget) => widget.widgetId === widgetId);
  if (!dragged) return null;
  const rowSpan = getKpiGridRowSpan(dragged.gridWidth, dragged.gridHeight, containerWidth);
  const maxGridX = Math.max(0, 12 - dragged.gridWidth);
  const bounded = {
    gridX: Math.max(0, Math.min(maxGridX, Math.trunc(desired.gridX))),
    gridY: Math.max(0, Math.trunc(desired.gridY)),
  };
  const tile = getKpiAddTileReservation(addTilePosition);
  const position = tile && kpiGridItemsOverlap({ ...bounded, gridWidth: dragged.gridWidth, rowSpan }, tile)
    ? findNearestKpiGridPosition(dragged.gridWidth, rowSpan, bounded, [tile])
    : bounded;
  const occupied: Array<{ gridX: number; gridY: number; gridWidth: number; rowSpan: number }> = tile ? [tile] : [];
  occupied.push({ ...position, gridWidth: dragged.gridWidth, rowSpan });
  const nextPositions = new Map<string, Pick<KpiWidget, 'gridX' | 'gridY'>>([[widgetId, position]]);
  [...widgets]
    .filter((widget) => widget.widgetId !== widgetId)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .forEach((widget) => {
      const itemRowSpan = getKpiGridRowSpan(widget.gridWidth, widget.gridHeight, containerWidth);
      const next = findFirstKpiGridPosition(widget.gridWidth, itemRowSpan, occupied);
      occupied.push({ ...next, gridWidth: widget.gridWidth, rowSpan: itemRowSpan });
      nextPositions.set(widget.widgetId, next);
    });
  return {
    layout: widgets.map((widget) => ({ ...widget, ...nextPositions.get(widget.widgetId) })),
    position,
  };
}

function moveKpiWidgetBeforeTarget<T extends KpiWidget>(widgets: readonly T[], draggedId: string, targetId: string): T[] | null {
  const moved = moveKpiWidget(widgets, draggedId, targetId);
  if (!moved) return null;
  const ordered = [...widgets].sort((left, right) => left.sortOrder - right.sortOrder);
  const fromIndex = ordered.findIndex((widget) => widget.widgetId === draggedId);
  const targetIndex = ordered.findIndex((widget) => widget.widgetId === targetId);
  if (fromIndex < targetIndex) {
    const movingIndex = moved.findIndex((widget) => widget.widgetId === draggedId);
    if (movingIndex < 0) return moved;
    const [dragged] = moved.splice(movingIndex, 1);
    if (!dragged) return moved;
    const beforeTargetIndex = moved.findIndex((widget) => widget.widgetId === targetId);
    if (beforeTargetIndex < 0) return moved;
    moved.splice(beforeTargetIndex, 0, dragged);
    return moved.map((widget, index) => ({ ...widget, sortOrder: index }));
  }
  return moved;
}

function getKpiContentWidth(element: HTMLElement | null): number {
  if (!element) return 0;
  const styles = window.getComputedStyle(element);
  const width = element.getBoundingClientRect().width
    - Number.parseFloat(styles.paddingLeft)
    - Number.parseFloat(styles.paddingRight)
    - Number.parseFloat(styles.borderLeftWidth)
    - Number.parseFloat(styles.borderRightWidth);
  return Number.isFinite(width) ? Math.max(0, width) : 0;
}

const KPI_ROUTE_PATH = '/dashboard/kpi';

function readKpiRoute() {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  if (pathname !== '/' && pathname !== KPI_ROUTE_PATH) {
    return { departmentId: null, dashboardId: null };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    departmentId: params.get('departmentId'),
    dashboardId: params.get('dashboardId'),
  };
}

function writeKpiRoute(
  departmentId: string | null,
  dashboardId: string | null,
  mode: 'push' | 'replace' = 'push',
) {
  const params = new URLSearchParams();
  if (departmentId) params.set('departmentId', departmentId);
  if (dashboardId) params.set('dashboardId', dashboardId);
  const query = params.toString();
  const target = `${KPI_ROUTE_PATH}${query ? `?${query}` : ''}`;
  const current = `${window.location.pathname}${window.location.search}`;
  if (current === target && !window.location.hash) return;
  window.history[mode === 'push' ? 'pushState' : 'replaceState'](window.history.state, '', target);
}

function buildDepartmentTree(departments: KpiDepartment[]): DepartmentTreeNode[] {
  const nodes = new Map(departments.map((department) => [
    department.departmentId,
    { ...department, children: [] as DepartmentTreeNode[] },
  ]));
  const roots: DepartmentTreeNode[] = [];
  nodes.forEach((node) => {
    const parent = node.parentDepartmentId ? nodes.get(node.parentDepartmentId) : null;
    if (parent && parent.departmentId !== node.departmentId) parent.children.push(node);
    else roots.push(node);
  });
  const sortNodes = (siblings: DepartmentTreeNode[]) => {
    siblings.sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
    siblings.forEach((node) => sortNodes(node.children));
  };
  sortNodes(roots);
  return roots;
}

function getDepartmentDescendantIds(departmentId: string, departments: KpiDepartment[]): Set<string> {
  const descendants = new Set<string>();
  const pending = [departmentId];
  while (pending.length > 0) {
    const parentId = pending.pop();
    departments.forEach((department) => {
      if (department.parentDepartmentId === parentId && !descendants.has(department.departmentId)) {
        descendants.add(department.departmentId);
        pending.push(department.departmentId);
      }
    });
  }
  return descendants;
}

function getDepartmentPathLabel(departmentId: string, departments: KpiDepartment[]): string {
  const byId = new Map(departments.map((department) => [department.departmentId, department]));
  const path: string[] = [];
  const visited = new Set<string>();
  let current = byId.get(departmentId);
  while (current && !visited.has(current.departmentId)) {
    visited.add(current.departmentId);
    path.unshift(current.name);
    current = current.parentDepartmentId ? byId.get(current.parentDepartmentId) : undefined;
  }
  return path.join(' / ');
}

function placeDepartmentActionsMenu(details: HTMLDetailsElement) {
  const menu = details.querySelector<HTMLElement>('.kpi-tree-actions-menu');
  const summary = details.querySelector('summary');
  if (!menu || !summary) return;
  if (!details.open) {
    menu.style.removeProperty('left');
    menu.style.removeProperty('top');
    return;
  }

  const anchor = summary.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.left = '0px';
  menu.style.top = '0px';
  const left = Math.max(8, Math.min(anchor.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8));
  const top = Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - menu.offsetHeight - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

export function KpiPage() {
  const { locale, messages: m } = useLocale();
  const { markUnauthenticated, user } = useAuth();
  const isAdmin = user?.isAdmin === true;
  const [departments, setDepartments] = useState<KpiDepartment[]>([]);
  const [departmentId, setDepartmentId] = useState<string | null>(() => readKpiRoute().departmentId);
  const [dashboardId, setDashboardId] = useState<string | null>(() => readKpiRoute().dashboardId);
  const [dashboard, setDashboard] = useState<KpiDashboard | null>(null);
  const [definitions, setDefinitions] = useState<KpiDefinition[]>([]);
  const [workspaceState, setWorkspaceState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [dashboardState, setDashboardState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [workspaceError, setWorkspaceError] = useState(false);
  const [dashboardError, setDashboardError] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, CellDraft>>({});
  const [newDepartmentName, setNewDepartmentName] = useState('');
  const [newChildDepartmentName, setNewChildDepartmentName] = useState('');
  const [dashboardSearch, setDashboardSearch] = useState('');
  const [editingDepartmentId, setEditingDepartmentId] = useState<string | null>(null);
  const [editingDepartmentName, setEditingDepartmentName] = useState('');
  const [editingDepartmentParentId, setEditingDepartmentParentId] = useState('');
  const [editingDepartmentEmoji, setEditingDepartmentEmoji] = useState('');
  const [editingDepartmentColor, setEditingDepartmentColor] = useState<KpiDepartmentColor | ''>('');
  const [departmentDeleteTarget, setDepartmentDeleteTarget] = useState<DepartmentTreeNode | null>(null);
  const [departmentDeleteTypedName, setDepartmentDeleteTypedName] = useState('');
  const [departmentDeleteError, setDepartmentDeleteError] = useState(false);
  const [dashboardDeleteError, setDashboardDeleteError] = useState<string | null>(null);
  const [deletingDashboardId, setDeletingDashboardId] = useState<string | null>(null);
  const [creatingChildDepartmentId, setCreatingChildDepartmentId] = useState<string | null>(null);
  const [createDashboardDepartmentId, setCreateDashboardDepartmentId] = useState<string | null>(null);
  const [expandedDepartmentIds, setExpandedDepartmentIds] = useState<Set<string>>(() => new Set());
  const [isRailCollapsed, setIsRailCollapsed] = useState(() => {
    try {
      return typeof window !== 'undefined' && window.localStorage.getItem('kpi-department-rail-collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [departmentEditError, setDepartmentEditError] = useState(false);
  const [dashboardNameDraft, setDashboardNameDraft] = useState('');
  const [dashboardDescriptionDraft, setDashboardDescriptionDraft] = useState('');
  const [dashboardInfoSaving, setDashboardInfoSaving] = useState(false);
  const [dashboardInfoError, setDashboardInfoError] = useState(false);
  const [addWidgetContext, setAddWidgetContext] = useState<KpiAddWidgetDialogContext | null>(null);
  const [settingsWidget, setSettingsWidget] = useState<KpiWidget | null>(null);
  const [editingWidgetId, setEditingWidgetId] = useState<string | null>(null);
  const [valueEntryWidgetId, setValueEntryWidgetId] = useState<string | null>(null);
  const [widgetTitleDraft, setWidgetTitleDraft] = useState('');
  const [widgetDescriptionDraft, setWidgetDescriptionDraft] = useState('');
  const [widgetSeriesDraft, setWidgetSeriesDraft] = useState<string[]>([]);
  const [widgetEditSaving, setWidgetEditSaving] = useState(false);
  const [widgetEditError, setWidgetEditError] = useState(false);
  const [departmentSaving, setDepartmentSaving] = useState(false);
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [rangeError, setRangeError] = useState(false);
  const [rangeSaving, setRangeSaving] = useState(false);
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const widgetClipboardRef = useRef<{ dashboardId: string; widget: KpiWidget } | null>(null);
  const duplicateWidgetInFlight = useRef(false);
  const [widgetMovePreview, setWidgetMovePreview] = useState<KpiWidgetMovePreview | null>(null);
  const widgetMovePreviewRef = useRef(widgetMovePreview);
  widgetMovePreviewRef.current = widgetMovePreview;
  const widgetFlipPreviousRectsRef = useRef(new Map<string, DOMRect>());
  const widgetFlipAnimationFrameRef = useRef<number | null>(null);
  const widgetFlipInlineStylesRef = useRef(new Map<HTMLElement, { transform: string; transition: string }>());
  const [widgetResizeDraft, setWidgetResizeDraft] = useState<KpiWidgetResizeDraft | null>(null);
  const [widgetSeriesColorDrafts, setWidgetSeriesColorDrafts] = useState<Record<string, string | null>>({});
  const [gridContainerWidth, setGridContainerWidth] = useState(0);
  const gridContainerWidthRef = useRef(gridContainerWidth);
  gridContainerWidthRef.current = gridContainerWidth;
  const gridContentRef = useRef<HTMLDivElement | null>(null);
  const widgetGridRef = useRef<HTMLDivElement | null>(null);
  const widgetMoveSessionRef = useRef<KpiWidgetMoveSession | null>(null);
  const widgetResizeDragRef = useRef<KpiWidgetResizeDrag | null>(null);
  const draftsRef = useRef<Record<string, CellDraft>>({});
  draftsRef.current = drafts;
  const dashboardRef = useRef(dashboard);
  dashboardRef.current = dashboard;
  const setWidgetMovePreviewWithFlip = useCallback((next: KpiWidgetMovePreview | null) => {
    const previousPreview = widgetMovePreviewRef.current;
    const previousLayout = previousPreview?.layout ?? dashboardRef.current?.widgets ?? [];
    const nextLayout = next?.layout ?? dashboardRef.current?.widgets ?? [];
    if (!haveSameKpiWidgetLayout(previousLayout, nextLayout)) {
      const previousRects = new Map<string, DOMRect>();
      const grid = widgetGridRef.current;
      const floatingWidgetId = previousPreview?.active ? previousPreview.widgetId : null;
      grid?.querySelectorAll<HTMLElement>('[data-kpi-widget-id]').forEach((element) => {
        const widgetId = element.dataset.kpiWidgetId;
        if (!widgetId || widgetId === floatingWidgetId) return;
        previousRects.set(widgetId, element.getBoundingClientRect());
      });
      widgetFlipPreviousRectsRef.current = previousRects;
    }
    widgetMovePreviewRef.current = next;
    setWidgetMovePreview(next);
  }, []);
  const lastApiLayoutsRef = useRef(new Map<string, Map<string, KpiWidgetLayoutSnapshot>>());
  const dashboardFetchGenerationsRef = useRef(new Map<string, number>());
  const layoutRevisionsRef = useRef(new Map<string, number>());
  const layoutWritesInFlightRef = useRef(new Map<string, number>());
  const layoutWriteQueuesRef = useRef(new Map<string, Promise<void>>());
  const dashboardStatusOwnersRef = useRef(new Map<string, number>());
  const draftSaveTimers = useRef(new Map<string, number>());
  const savingCells = useRef(new Set<string>());
  const editsDuringSave = useRef(new Map<string, CellDraft>());
  const rootDepartmentDetails = useRef<HTMLDetailsElement | null>(null);
  const expandedDepartmentsInitialized = useRef(false);
  const pollInFlight = useRef(false);
  const cancelPopstateRef = useRef(false);
  const dashboardIdRef = useRef(dashboardId);
  dashboardIdRef.current = dashboardId;
  const valueChangesChannel = useRef<BroadcastChannel | null>(null);
  const valueChangeSourceId = useRef<string | null>(null);
  if (valueChangeSourceId.current === null) valueChangeSourceId.current = window.crypto.randomUUID();

  const selectedDepartment = departments.find((item) => item.departmentId === departmentId) ?? null;
  const valueEntryWidget = dashboard?.widgets.find((item) => item.widgetId === valueEntryWidgetId) ?? null;
  const seriesChoices = useMemo<SeriesChoice[]>(() => definitions.flatMap((definition) =>
    definition.series.map((series) => ({
      seriesId: series.seriesId,
      label: series.label,
      definitionName: definition.name,
      cadence: definition.cadence,
      unit: definition.unit,
    }))), [definitions]);
  const widgetBeingEdited = dashboard?.widgets.find((item) => item.widgetId === editingWidgetId);
  const widgetEditSeriesChoices = widgetBeingEdited
    ? widgetBeingEdited.series
      .map((series) => seriesChoices.find((choice) => choice.seriesId === series.seriesId))
      .filter((choice): choice is SeriesChoice => choice !== undefined)
    : seriesChoices;
  const widgetEditValidation = validateKpiSeries(widgetSeriesDraft.map((id) => seriesChoices.find((item) => item.seriesId === id)).filter((item): item is SeriesChoice => Boolean(item)));
  const hasUnsavedCells = Object.values(drafts).some((draft) => draft.status !== 'saved');
  const dashboardLayoutWidgets = useMemo(() => {
    if (!dashboard || gridContainerWidth <= 0) return [];
    const apiLayouts = lastApiLayoutsRef.current.get(dashboard.dashboardId);
    const widgetsWithApiLayouts = dashboard.widgets.map((widget) => {
      const apiLayout = apiLayouts?.get(widget.widgetId);
      return apiLayout ? { ...widget, ...apiLayout } : widget;
    });
    return normalizeKpiGridLayout(widgetsWithApiLayouts, gridContainerWidth);
  }, [dashboard, gridContainerWidth]);
  const dashboardGridItems = useMemo(() => gridContainerWidth > 0
    ? getKpiGridItems(dashboardLayoutWidgets, gridContainerWidth)
    : [], [dashboardLayoutWidgets, gridContainerWidth]);
  const addTilePosition = useMemo(() => getKpiAddTilePosition(dashboardGridItems), [dashboardGridItems]);
  const visibleWidgetLayout = widgetMovePreview?.layout ?? dashboardLayoutWidgets;
  const visibleAddTilePosition = widgetMovePreview?.addTilePosition ?? addTilePosition;
  const dialogLayoutReady = Boolean(addWidgetContext
    && dashboardId === addWidgetContext.dashboardId
    && dashboard?.dashboardId === addWidgetContext.dashboardId
    && gridContainerWidth > 0);
  const dialogLayoutWidgets = useMemo(() => {
    if (!addWidgetContext
      || dashboardId !== addWidgetContext.dashboardId
      || dashboard?.dashboardId !== addWidgetContext.dashboardId
      || gridContainerWidth <= 0) return [];
    return dashboardGridItems;
  }, [addWidgetContext, dashboard, dashboardGridItems, dashboardId, gridContainerWidth]);

  const handleRequestError = useCallback((error: unknown) => {
    if (error instanceof ApiRequestError && error.status === 401) markUnauthenticated();
  }, [markUnauthenticated]);

  const syncSavedDrafts = useCallback((next: KpiDashboard) => {
    const serverPoints = new Map<string, KpiPoint>();
    next.widgets.forEach((widget) => widget.series.forEach((series) => series.points.forEach((point) => {
      serverPoints.set(cellKey(series.seriesId, point.periodStart), point);
    })));
    const current = draftsRef.current;
    let changed = false;
    const reconciled = { ...current };
    Object.entries(current).forEach(([key, draft]) => {
      if (!canApplyServerKpiPointUpdate(draft.status)) return;
      const point = serverPoints.get(key);
      if (!point) return;
      const updated: CellDraft = {
        ...draft,
        value: point.value ?? '',
        comment: point.comment ?? '',
        expectedUpdatedAt: point.updatedAt,
        latestServerValue: undefined,
        latestServerComment: undefined,
        status: 'saved',
      };
      if (draft.value === updated.value && draft.comment === updated.comment
        && draft.expectedUpdatedAt === updated.expectedUpdatedAt
        && draft.latestServerValue === undefined && draft.latestServerComment === undefined) return;
      reconciled[key] = updated;
      changed = true;
    });
    if (changed) {
      draftsRef.current = reconciled;
      setDrafts(reconciled);
    }
  }, []);

  const refreshWorkspace = useCallback(async () => {
    try {
      const next = await listKpiDepartments();
      const route = readKpiRoute();
      const routeDepartment = next.find((item) => item.departmentId === route.departmentId);
      const routeDashboardDepartment = route.dashboardId
        ? next.find((item) => item.dashboards.some((dashboardItem) => dashboardItem.dashboardId === route.dashboardId))
        : undefined;
      const selected = routeDepartment
        ?? routeDashboardDepartment
        ?? next.find((item) => !item.parentDepartmentId)
        ?? next[0]
        ?? null;
      const selectedDashboard = selected?.dashboards.find((item) => item.dashboardId === route.dashboardId) ?? null;
      const nextDepartmentId = selected?.departmentId ?? null;
      const nextDashboardId = selectedDashboard?.dashboardId ?? null;
      setDepartments(next);
      setDepartmentId(nextDepartmentId);
      setDashboardId(nextDashboardId);
      writeKpiRoute(nextDepartmentId, nextDashboardId, 'replace');
      setExpandedDepartmentIds((current) => {
        const departmentIds = new Set(next.map((item) => item.departmentId));
        const expanded = new Set([...current].filter((id) => departmentIds.has(id)));
        if (!expandedDepartmentsInitialized.current) {
          next.filter((item) => !item.parentDepartmentId).forEach((item) => expanded.add(item.departmentId));
          expandedDepartmentsInitialized.current = true;
        }
        const departmentsById = new Map(next.map((item) => [item.departmentId, item]));
        let ancestor: KpiDepartment | null = selected;
        while (ancestor) {
          expanded.add(ancestor.departmentId);
          ancestor = ancestor.parentDepartmentId ? departmentsById.get(ancestor.parentDepartmentId) ?? null : null;
        }
        return expanded;
      });
      setWorkspaceError(false);
      setWorkspaceState('ready');
      setDepartmentDeleteError(false);
      return next;
    } catch (error) {
      handleRequestError(error);
      setWorkspaceError(true);
      setWorkspaceState('error');
      return null;
    }
  }, [handleRequestError]);

  const refreshDashboard = useCallback(async (id: string, options: { quiet?: boolean } = {}) => {
    const fetchGeneration = (dashboardFetchGenerationsRef.current.get(id) ?? 0) + 1;
    dashboardFetchGenerationsRef.current.set(id, fetchGeneration);
    if (!options.quiet && dashboardIdRef.current === id) {
      dashboardStatusOwnersRef.current.set(id, fetchGeneration);
      setDashboardState('loading');
    } else if (dashboardStatusOwnersRef.current.has(id)) {
      dashboardStatusOwnersRef.current.set(id, fetchGeneration);
    }
    const layoutRevisionAtStart = layoutRevisionsRef.current.get(id) ?? 0;
    const writeWasInFlightAtStart = (layoutWritesInFlightRef.current.get(id) ?? 0) > 0;
    try {
      const loaded = await loadKpiDashboard(id);
      if (dashboardFetchGenerationsRef.current.get(id) !== fetchGeneration) return null;
      const currentLayouts = lastApiLayoutsRef.current.get(id);
      const layoutChangedDuringLoad = writeWasInFlightAtStart
        || (layoutWritesInFlightRef.current.get(id) ?? 0) > 0
        || (layoutRevisionsRef.current.get(id) ?? 0) !== layoutRevisionAtStart;
      const widgetsWithCurrentLayouts = layoutChangedDuringLoad
        ? loaded.widgets.map((widget) => {
          const currentLayout = currentLayouts?.get(widget.widgetId);
          return currentLayout ? { ...widget, ...currentLayout } : widget;
        })
        : loaded.widgets;
      lastApiLayoutsRef.current.set(id, snapshotKpiWidgetLayouts(widgetsWithCurrentLayouts));
      const width = getKpiContentWidth(gridContentRef.current) || gridContainerWidthRef.current;
      const next = width > 0
        ? { ...loaded, widgets: normalizeKpiGridLayout(widgetsWithCurrentLayouts, width) }
        : { ...loaded, widgets: widgetsWithCurrentLayouts };
      if (dashboardIdRef.current === id) {
        syncSavedDrafts(next);
        setDashboard(next);
        if (!options.quiet) {
          setDashboardNameDraft(next.name);
          setDashboardDescriptionDraft(next.description ?? '');
          setRangeStart(next.rangeStart ?? '');
          setRangeEnd(next.rangeEnd ?? '');
          setRangeError(false);
        }
        const ownsStatus = dashboardStatusOwnersRef.current.get(id) === fetchGeneration || !options.quiet;
        if (dashboardStatusOwnersRef.current.get(id) === fetchGeneration) {
          dashboardStatusOwnersRef.current.delete(id);
        }
        if (ownsStatus) {
          setDashboardState('ready');
        }
        setDashboardError(false);
      } else if (dashboardStatusOwnersRef.current.get(id) === fetchGeneration) {
        dashboardStatusOwnersRef.current.delete(id);
      }
      return next;
    } catch (error) {
      if (dashboardFetchGenerationsRef.current.get(id) !== fetchGeneration) return null;
      handleRequestError(error);
      const ownsStatus = dashboardStatusOwnersRef.current.get(id) === fetchGeneration || !options.quiet;
      if (dashboardStatusOwnersRef.current.get(id) === fetchGeneration) dashboardStatusOwnersRef.current.delete(id);
      if (dashboardIdRef.current === id && ownsStatus) {
        setDashboardError(true);
        setDashboardState('error');
      }
      return null;
    }
  }, [handleRequestError, syncSavedDrafts]);

  const reconcileKpiLayout = useCallback(async (id: string): Promise<boolean> => {
    const revisionAtStart = layoutRevisionsRef.current.get(id) ?? 0;
    const fetchGeneration = (dashboardFetchGenerationsRef.current.get(id) ?? 0) + 1;
    dashboardFetchGenerationsRef.current.set(id, fetchGeneration);
    const isActiveAtStart = dashboardIdRef.current === id;
    if (isActiveAtStart || dashboardStatusOwnersRef.current.has(id)) {
      dashboardStatusOwnersRef.current.set(id, fetchGeneration);
    }
    try {
      const loaded = await loadKpiDashboard(id);
      if ((layoutRevisionsRef.current.get(id) ?? 0) !== revisionAtStart
        || dashboardFetchGenerationsRef.current.get(id) !== fetchGeneration) return false;
      const layouts = snapshotKpiWidgetLayouts(loaded.widgets);
      lastApiLayoutsRef.current.set(id, layouts);
      const widgets = loaded.widgets.map((widget) => {
        const apiLayout = layouts.get(widget.widgetId);
        return apiLayout ? { ...widget, ...apiLayout } : widget;
      });
      const width = getKpiContentWidth(gridContentRef.current) || gridContainerWidthRef.current;
      const next = width > 0
        ? { ...loaded, widgets: normalizeKpiGridLayout(widgets, width) }
        : { ...loaded, widgets };
      if (dashboardIdRef.current === id) {
        syncSavedDrafts(next);
        setDashboard(next);
        if (dashboardStatusOwnersRef.current.get(id) === fetchGeneration) {
          dashboardStatusOwnersRef.current.delete(id);
        }
        setDashboardState('ready');
        setDashboardError(false);
      } else if (dashboardStatusOwnersRef.current.get(id) === fetchGeneration) {
        dashboardStatusOwnersRef.current.delete(id);
      }
      return true;
    } catch (error) {
      if ((layoutRevisionsRef.current.get(id) ?? 0) !== revisionAtStart
        || dashboardFetchGenerationsRef.current.get(id) !== fetchGeneration) return false;
      handleRequestError(error);
      if (dashboardStatusOwnersRef.current.get(id) === fetchGeneration) {
        dashboardStatusOwnersRef.current.delete(id);
      }
      if (dashboardIdRef.current === id) {
        setDashboardError(true);
        setDashboardState('error');
      }
      return false;
    }
  }, [handleRequestError, syncSavedDrafts]);

  const duplicateWidget = useCallback(async (sourceWidget: KpiWidget, targetDashboardId: string) => {
    if (duplicateWidgetInFlight.current) return;
    const currentDashboard = dashboardRef.current;
    const containerWidth = gridContainerWidthRef.current;
    if (!currentDashboard || currentDashboard.dashboardId !== targetDashboardId || containerWidth <= 0) return;
    duplicateWidgetInFlight.current = true;
    const suffix = ` (${m.kpiWidgetCopySuffix})`;
    const currentLayout = normalizeKpiGridLayout(currentDashboard.widgets, containerWidth);
    const gridItems = getKpiGridItems(currentLayout, containerWidth);
    const copyPosition = findKpiCreatePosition(
      gridItems,
      sourceWidget.gridWidth,
      getKpiGridRowSpan(sourceWidget.gridWidth, sourceWidget.gridHeight, containerWidth),
      getKpiAddTilePosition(gridItems),
    );
    try {
      const created = await createKpiWidget(targetDashboardId, {
        title: `${sourceWidget.title.slice(0, Math.max(0, 160 - suffix.length))}${suffix}`,
        description: sourceWidget.description,
        seriesIds: sourceWidget.series.map((series) => series.seriesId),
        ...copyPosition,
        gridWidth: sourceWidget.gridWidth,
        gridHeight: sourceWidget.gridHeight,
        periodCount: sourceWidget.periodCount,
        showLinearTrend: sourceWidget.showLinearTrend,
        showMovingAverage: sourceWidget.showMovingAverage,
        series: sourceWidget.series.map((series) => ({ seriesId: series.seriesId, axisSide: series.axisSide })),
        seriesColors: Object.fromEntries(sourceWidget.series.map((series) => [series.seriesId, series.color] as const)),
      });
      if (dashboardIdRef.current === targetDashboardId) {
        setSelectedWidgetId(created.widgetId);
        await refreshDashboard(targetDashboardId, { quiet: true });
      }
    } catch (error) {
      handleRequestError(error);
      if (dashboardIdRef.current === targetDashboardId) setDashboardError(true);
    } finally {
      duplicateWidgetInFlight.current = false;
    }
  }, [handleRequestError, m.kpiWidgetCopySuffix, refreshDashboard]);

  useEffect(() => {
    setSelectedWidgetId(null);
  }, [dashboardId]);

  useEffect(() => {
    const handleWidgetClipboardShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.repeat) return;
      const key = event.code === 'KeyC' ? 'c' : event.code === 'KeyV' ? 'v' : event.key.toLowerCase();
      if (key !== 'c' && key !== 'v') return;
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], dialog[open]')) return;
      if (window.getSelection()?.isCollapsed === false) return;
      const currentDashboard = dashboardRef.current;
      const currentDashboardId = dashboardIdRef.current;
      if (!isAdmin || !currentDashboard || currentDashboard.dashboardId !== currentDashboardId) return;
      if (key === 'c') {
        const selected = currentDashboard.widgets.find((widget) => widget.widgetId === selectedWidgetId);
        if (!selected) return;
        event.preventDefault();
        widgetClipboardRef.current = { dashboardId: currentDashboard.dashboardId, widget: selected };
        return;
      }
      const copied = widgetClipboardRef.current;
      if (!copied || copied.dashboardId !== currentDashboard.dashboardId) return;
      event.preventDefault();
      void duplicateWidget(copied.widget, currentDashboard.dashboardId);
    };
    window.addEventListener('keydown', handleWidgetClipboardShortcut);
    return () => window.removeEventListener('keydown', handleWidgetClipboardShortcut);
  }, [duplicateWidget, isAdmin, selectedWidgetId]);

  const persistKpiLayout = useCallback(async (
    id: string,
    candidate: readonly KpiWidget[] | KpiWidgetLayoutCandidateFactory,
    options: KpiWidgetLayoutPersistOptions = {},
  ): Promise<boolean> => {
    const previousWrite = layoutWriteQueuesRef.current.get(id);
    let releaseWrite!: () => void;
    const currentWrite = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const queuedWrite = (previousWrite ?? Promise.resolve()).then(() => currentWrite);
    layoutWriteQueuesRef.current.set(id, queuedWrite);
    if (previousWrite) await previousWrite;

    try {
      const apiLayouts = lastApiLayoutsRef.current.get(id);
      if (!apiLayouts) {
        if (dashboardIdRef.current === id) setDashboardError(true);
        if (options.onFailure) {
          options.onFailure.rollbackLocal();
          await options.onFailure.refreshAfterCompensation();
        }
        return false;
      }
      const previousLayouts = new Map(apiLayouts);

      const candidateWidgets = typeof candidate === 'function' ? candidate(previousLayouts) : candidate;
      if (!candidateWidgets) return false;

      const changes: Array<{ widgetId: string; patch: KpiWidgetLayoutPatch }> = [];
      candidateWidgets.forEach((widget) => {
        const previous = previousLayouts.get(widget.widgetId);
        const patch: KpiWidgetLayoutPatch = {};
        if (!previous || previous.gridX !== widget.gridX) patch.gridX = widget.gridX;
        if (!previous || previous.gridY !== widget.gridY) patch.gridY = widget.gridY;
        if (!previous || previous.gridWidth !== widget.gridWidth) patch.gridWidth = widget.gridWidth;
        if (!previous || previous.gridHeight !== widget.gridHeight) patch.gridHeight = widget.gridHeight;
        if (!previous || previous.sortOrder !== widget.sortOrder) patch.sortOrder = widget.sortOrder;
        if (Object.keys(patch).length > 0) changes.push({ widgetId: widget.widgetId, patch });
      });
      if (changes.length === 0) {
        lastApiLayoutsRef.current.set(id, snapshotKpiWidgetLayouts(candidateWidgets));
        options.onSuccess?.(candidateWidgets);
        return true;
      }

      const beginLayoutWrite = () => {
        layoutWritesInFlightRef.current.set(id, (layoutWritesInFlightRef.current.get(id) ?? 0) + 1);
      };
      const finishLayoutWrite = () => {
        const remainingWrites = (layoutWritesInFlightRef.current.get(id) ?? 1) - 1;
        if (remainingWrites > 0) layoutWritesInFlightRef.current.set(id, remainingWrites);
        else layoutWritesInFlightRef.current.delete(id);
      };
      layoutRevisionsRef.current.set(id, (layoutRevisionsRef.current.get(id) ?? 0) + 1);
      beginLayoutWrite();
      let results: PromiseSettledResult<KpiWidget>[];
      try {
        results = await Promise.allSettled(changes.map(({ widgetId, patch }) =>
          Promise.resolve().then(() => updateKpiWidget(widgetId, patch))));
      } finally {
        finishLayoutWrite();
      }
      const failed = results.find((result) => result.status === 'rejected');

      if (failed?.status === 'rejected') {
        handleRequestError(failed.reason);
        if (options.onFailure) {
          options.onFailure.rollbackLocal();
          const succeededChanges = changes.filter((_, index) => results[index]?.status === 'fulfilled');
          if (succeededChanges.length > 0) {
            layoutRevisionsRef.current.set(id, (layoutRevisionsRef.current.get(id) ?? 0) + 1);
            beginLayoutWrite();
            try {
              await Promise.allSettled(succeededChanges.map(({ widgetId, patch }) => {
                const previous = previousLayouts.get(widgetId);
                if (!previous) return Promise.resolve(undefined);
                const rollbackPatch: KpiWidgetLayoutPatch = {
                  ...(patch.gridX !== undefined ? { gridX: previous.gridX } : {}),
                  ...(patch.gridY !== undefined ? { gridY: previous.gridY } : {}),
                  ...(patch.gridWidth !== undefined ? { gridWidth: previous.gridWidth } : {}),
                  ...(patch.gridHeight !== undefined ? { gridHeight: previous.gridHeight } : {}),
                  ...(patch.sortOrder !== undefined ? { sortOrder: previous.sortOrder } : {}),
                };
                return Promise.resolve().then(() => updateKpiWidget(widgetId, rollbackPatch));
              }));
            } finally {
              finishLayoutWrite();
            }
          }
          await options.onFailure.refreshAfterCompensation();
        } else {
          await reconcileKpiLayout(id);
        }
        return false;
      }

      const savedWidgets = new Map(changes.flatMap(({ widgetId }, index) => {
        const result = results[index];
        return result?.status === 'fulfilled' ? [[widgetId, result.value] as const] : [];
      }));
      const confirmedWidgets = candidateWidgets.map((widget) => {
        const saved = savedWidgets.get(widget.widgetId);
        return saved ? { ...widget, ...saved } : widget;
      });
      lastApiLayoutsRef.current.set(id, snapshotKpiWidgetLayouts(confirmedWidgets));
      options.onSuccess?.(confirmedWidgets);
      return true;
    } finally {
      releaseWrite();
      if (layoutWriteQueuesRef.current.get(id) === queuedWrite) layoutWriteQueuesRef.current.delete(id);
    }
  }, [handleRequestError, reconcileKpiLayout]);

  const persistExplicitDashboardLayout = useCallback(async (candidate: KpiDashboard): Promise<boolean> => {
    const width = getKpiContentWidth(gridContentRef.current) || gridContainerWidthRef.current;
    if (width <= 0) return false;
    const widgets = normalizeKpiGridLayout(candidate.widgets, width);
    if (!await persistKpiLayout(candidate.dashboardId, widgets)) return false;
    setDashboard((current) => current?.dashboardId === candidate.dashboardId
      ? { ...current, widgets }
      : current);
    return true;
  }, [persistKpiLayout]);

  useEffect(() => {
    void refreshWorkspace();
  }, [refreshWorkspace]);

  useEffect(() => {
    const host = gridContentRef.current;
    if (!host) return;

    const storeWidth = (width: number) => {
      const nextWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
      setGridContainerWidth((current) => current === nextWidth ? current : nextWidth);
    };
    storeWidth(getKpiContentWidth(host));
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) storeWidth(entry.contentRect.width);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const session = widgetMoveSessionRef.current;
    if (session && session.dashboardId !== dashboardId) {
      cleanupKpiWidgetMoveSession(session);
      widgetMoveSessionRef.current = null;
    }
    setWidgetMovePreview(null);
  }, [dashboardId]);

  useLayoutEffect(() => {
    const previousRects = widgetFlipPreviousRectsRef.current;
    if (previousRects.size === 0) return;
    widgetFlipPreviousRectsRef.current = new Map();

    if (widgetFlipAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(widgetFlipAnimationFrameRef.current);
      widgetFlipAnimationFrameRef.current = null;
    }
    cancelKpiWidgetFlipStyles(widgetFlipInlineStylesRef.current);

    const grid = widgetGridRef.current;
    if (!grid) return;
    const floatingWidgetId = widgetMovePreview?.active ? widgetMovePreview.widgetId : null;
    grid.querySelectorAll<HTMLElement>('[data-kpi-widget-id]').forEach((element) => {
      const widgetId = element.dataset.kpiWidgetId;
      const previous = widgetId ? previousRects.get(widgetId) : null;
      if (!widgetId || widgetId === floatingWidgetId || !previous) return;
      const current = element.getBoundingClientRect();
      const dx = previous.left - current.left;
      const dy = previous.top - current.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      const original = { transform: element.style.transform, transition: element.style.transition };
      widgetFlipInlineStylesRef.current.set(element, original);
      element.style.transition = 'none';
      element.style.transform = `translate(${dx}px, ${dy}px) ${original.transform}`.trim();
    });
    if (widgetFlipInlineStylesRef.current.size === 0) return;

    grid.getBoundingClientRect();
    widgetFlipAnimationFrameRef.current = window.requestAnimationFrame(() => {
      widgetFlipAnimationFrameRef.current = null;
      finishKpiWidgetFlipStyles(widgetFlipInlineStylesRef.current);
    });
  }, [widgetMovePreview?.active, widgetMovePreview?.layout, widgetMovePreview?.widgetId]);

  useEffect(() => () => {
    if (widgetFlipAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(widgetFlipAnimationFrameRef.current);
      widgetFlipAnimationFrameRef.current = null;
    }
    cancelKpiWidgetFlipStyles(widgetFlipInlineStylesRef.current);
  }, []);

  useEffect(() => () => {
    const session = widgetMoveSessionRef.current;
    if (!session) return;
    cleanupKpiWidgetMoveSession(session);
    widgetMoveSessionRef.current = null;
  }, []);

  useEffect(() => {
    if (!dashboard || gridContainerWidth <= 0) return;
    const apiLayouts = lastApiLayoutsRef.current.get(dashboard.dashboardId);
    if (!apiLayouts) return;
    setDashboard((current) => {
      if (current?.dashboardId !== dashboard.dashboardId) return current;
      const widgetsWithApiLayouts = current.widgets.map((widget) => {
        const apiLayout = apiLayouts.get(widget.widgetId);
        return apiLayout ? { ...widget, ...apiLayout } : widget;
      });
      const widgets = normalizeKpiGridLayout(widgetsWithApiLayouts, gridContainerWidth);
      const unchanged = current.widgets.length === widgets.length
        && current.widgets.every((widget, index) => widget.gridX === widgets[index].gridX && widget.gridY === widgets[index].gridY);
      return unchanged ? current : { ...current, widgets };
    });
  }, [dashboard?.dashboardId, gridContainerWidth]);

  useEffect(() => {
    const restoreRoute = () => {
      if (cancelPopstateRef.current) {
        cancelPopstateRef.current = false;
        return;
      }
      if (hasUnsavedCells && !window.confirm(m.kpiUnsavedLeave)) {
        cancelPopstateRef.current = true;
        window.history.forward();
        return;
      }
      const route = readKpiRoute();
      draftsRef.current = {};
      setDrafts({});
      setValueEntryWidgetId(null);
      setDepartmentId(route.departmentId);
      setDashboardId(route.dashboardId);
    };
    window.addEventListener('popstate', restoreRoute);
    return () => window.removeEventListener('popstate', restoreRoute);
  }, [hasUnsavedCells, m.kpiUnsavedLeave]);

  useEffect(() => {
    try {
      window.localStorage.setItem('kpi-department-rail-collapsed', String(isRailCollapsed));
    } catch {
      // The panel remains usable when browser storage is unavailable.
    }
  }, [isRailCollapsed]);

  useEffect(() => {
    const openMenus = () => document.querySelectorAll<HTMLDetailsElement>('.kpi-tree-actions[open], .kpi-widget-menu[open]');
    const dismissOpenMenus = () => {
      openMenus().forEach((details) => details.removeAttribute('open'));
    };
    const dismissMenusOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (target instanceof Element && !target.closest('.kpi-widget')) setSelectedWidgetId(null);
      openMenus().forEach((details) => {
        if (!details.contains(target)) details.removeAttribute('open');
      });
    };
    window.addEventListener('scroll', dismissOpenMenus, true);
    window.addEventListener('resize', dismissOpenMenus);
    window.addEventListener('pointerdown', dismissMenusOnOutsidePointerDown, true);
    return () => {
      window.removeEventListener('scroll', dismissOpenMenus, true);
      window.removeEventListener('resize', dismissOpenMenus);
      window.removeEventListener('pointerdown', dismissMenusOnOutsidePointerDown, true);
    };
  }, []);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel('lng-dashboard-kpi-values');
    valueChangesChannel.current = channel;
    channel.onmessage = (event: MessageEvent<KpiValueUpdateMessage>) => {
      const update = event.data;
      if (!update || update.sourceId === valueChangeSourceId.current) return;
      applySavedPoint(update.seriesId, update.periodStart, update.value, update.comment, update.updatedAt);
      const key = cellKey(update.seriesId, update.periodStart);
      const current = draftsRef.current[key];
      if (canApplyServerKpiPointUpdate(current?.status)) {
        setCellDraft(key, {
          value: update.value ?? '',
          comment: update.comment ?? '',
          expectedUpdatedAt: update.updatedAt,
          status: 'saved',
          revision: current?.revision ?? 0,
        });
      }
    };
    return () => {
      channel.close();
      valueChangesChannel.current = null;
    };
  }, []);

  useEffect(() => {
    if (workspaceState !== 'ready') return;
    if (!selectedDepartment) {
      setDefinitions([]);
      setDashboardId(null);
      setDashboard(null);
      setDashboardState('idle');
      writeKpiRoute(null, null, 'replace');
      return;
    }
    loadKpiDefinitions(selectedDepartment.departmentId)
      .then(setDefinitions)
      .catch((error: unknown) => {
        handleRequestError(error);
        setDefinitions([]);
      });
  }, [handleRequestError, selectedDepartment, workspaceState]);

  useEffect(() => {
    if (dashboardId) void refreshDashboard(dashboardId);
    else {
      setDashboard(null);
      setDashboardState('idle');
    }
  }, [dashboardId, refreshDashboard]);

  useEffect(() => {
    if (!dashboardId || dashboardState !== 'ready') return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || pollInFlight.current) return;
      pollInFlight.current = true;
      void refreshDashboard(dashboardId, { quiet: true }).finally(() => {
        pollInFlight.current = false;
      });
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [dashboardId, dashboardState, refreshDashboard]);

  useEffect(() => () => {
    draftSaveTimers.current.forEach((timer) => window.clearTimeout(timer));
    draftSaveTimers.current.clear();
  }, [dashboardId]);

  useEffect(() => {
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedCells) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeave);
    return () => window.removeEventListener('beforeunload', warnBeforeLeave);
  }, [hasUnsavedCells]);

  const setCellDraft = useCallback((key: string, value: CellDraft) => {
    const next = { ...draftsRef.current, [key]: value };
    draftsRef.current = next;
    setDrafts(next);
  }, []);

  function applySavedPoint(
    seriesId: string,
    periodStart: string,
    value: string | null,
    comment: string | null,
    updatedAt: string | null,
  ) {
    setDashboard((current) => current ? {
      ...current,
      widgets: current.widgets.map((widget) => {
        if (!widget.series.some((series) => series.seriesId === seriesId)) return widget;
        return {
          ...widget,
          series: widget.series.map((series) => series.seriesId !== seriesId ? series : ({
            ...series,
            points: series.points.map((point) => point.periodStart !== periodStart ? point : ({
              ...point,
              value,
              comment,
              updatedAt,
            })),
          })),
        };
      }),
    } : current);
  }

  function notifyOtherViews(
    seriesId: string,
    periodStart: string,
    value: string | null,
    comment: string | null,
    updatedAt: string | null,
  ) {
    const channel = valueChangesChannel.current;
    const sourceId = valueChangeSourceId.current;
    if (!channel || !sourceId) return;
    channel.postMessage({
      sourceId,
      seriesId,
      periodStart,
      value,
      comment,
      updatedAt,
    } satisfies KpiValueUpdateMessage);
  }

  const saveCell = useCallback(async (
    seriesId: string,
    periodStart: string,
    draft: CellDraft,
  ) => {
    const key = cellKey(seriesId, periodStart);
    const scheduledTimer = draftSaveTimers.current.get(key);
    if (scheduledTimer !== undefined) window.clearTimeout(scheduledTimer);
    draftSaveTimers.current.delete(key);
    let submitted = draftsRef.current[key] ?? draft;
    if (submitted.revision < draft.revision) submitted = draft;
    if (savingCells.current.has(key)) {
      editsDuringSave.current.set(key, submitted);
      return;
    }
    if (submitted.status === 'saved') return;
    if (!submitted.value.trim()) {
      const existing = dashboardRef.current?.widgets.flatMap((widget) => widget.series)
        .find((series) => series.seriesId === seriesId)?.points.find((point) => point.periodStart === periodStart);
      if (submitted.comment.trim()) {
        setCellDraft(key, { ...submitted, status: 'error' });
        return;
      }
      if (!submitted.expectedUpdatedAt) {
        setCellDraft(key, { ...submitted, latestServerValue: undefined, latestServerComment: undefined, status: 'saved' });
        applySavedPoint(seriesId, periodStart, null, null, null);
        return;
      }
      if (!existing) return;
    }

    savingCells.current.add(key);
    setCellDraft(key, { ...submitted, status: 'saving' });
    let savedUpdatedAt: string | null = null;
    try {
      if (!submitted.value.trim()) {
        await deleteKpiValue(seriesId, periodStart, submitted.expectedUpdatedAt!);
        applySavedPoint(seriesId, periodStart, null, null, null);
        notifyOtherViews(seriesId, periodStart, null, null, null);
        setCellDraft(key, { ...submitted, value: '', comment: '', expectedUpdatedAt: null, latestServerValue: undefined, latestServerComment: undefined, status: 'saved' });
      } else {
        const saved = await writeKpiValue(seriesId, periodStart, {
          value: submitted.value,
          comment: submitted.comment.trim() || null,
          expectedUpdatedAt: submitted.expectedUpdatedAt,
        });
        savedUpdatedAt = saved.updatedAt;
        applySavedPoint(seriesId, periodStart, saved.value, saved.comment, saved.updatedAt);
        notifyOtherViews(seriesId, periodStart, saved.value, saved.comment, saved.updatedAt);
      }
      const deferred = editsDuringSave.current.get(key);
      if (deferred) {
        editsDuringSave.current.delete(key);
        const next = { ...deferred, expectedUpdatedAt: savedUpdatedAt, status: 'dirty' as const };
        setCellDraft(key, next);
        const timer = window.setTimeout(() => {
          draftSaveTimers.current.delete(key);
          void saveCell(seriesId, periodStart, next);
        }, 500);
        draftSaveTimers.current.set(key, timer);
      } else {
        const latest = draftsRef.current[key] ?? submitted;
        const changedDuringSave = latest.revision !== submitted.revision;
        setCellDraft(key, {
          ...latest,
          expectedUpdatedAt: savedUpdatedAt,
          latestServerValue: undefined,
          latestServerComment: undefined,
          status: changedDuringSave ? 'dirty' : 'saved',
        });
      }
    } catch (error) {
      handleRequestError(error);
      const conflict = error instanceof ApiRequestError && error.status === 409;
      editsDuringSave.current.delete(key);
      const conflictDashboardId = dashboardIdRef.current;
      if (conflict && conflictDashboardId) {
        const refreshed = await refreshDashboard(conflictDashboardId);
        if (dashboardIdRef.current !== conflictDashboardId) return;
        const serverPoint = refreshed?.widgets.flatMap((widget) => widget.series)
          .find((series) => series.seriesId === seriesId)?.points.find((point) => point.periodStart === periodStart);
        if (serverPoint) {
          const freshest = draftsRef.current[key] ?? submitted;
          setCellDraft(key, {
            ...freshest,
            expectedUpdatedAt: serverPoint.updatedAt,
            latestServerValue: serverPoint.value,
            latestServerComment: serverPoint.comment,
            status: 'conflict',
          });
          return;
        }
      }
      const latest = draftsRef.current[key] ?? submitted;
      setCellDraft(key, { ...latest, status: conflict ? 'conflict' : 'error' });
    } finally {
      savingCells.current.delete(key);
    }
  }, [handleRequestError, refreshDashboard, setCellDraft]);

  const saveWidgetValues = useCallback(async (targetWidget: KpiWidget) => {
    const cells = targetWidget.series.flatMap((series) => targetWidget.periods.map((period) => ({
      key: cellKey(series.seriesId, period),
      seriesId: series.seriesId,
      period,
    })));
    const attempted = new Map<string, number>();
    while (true) {
      const current = cells.map((cell) => ({ ...cell, draft: draftsRef.current[cell.key] }));
      if (current.some(({ key, draft }) => savingCells.current.has(key) || draft?.status === 'saving')) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
        continue;
      }
      const pending = current.filter(({ key, draft }) => draft && attempted.get(key) !== draft.revision && (draft.status === 'dirty' || draft.status === 'error'));
      if (pending.length) {
        pending.forEach(({ key, draft }) => attempted.set(key, draft!.revision));
        await Promise.all(pending.map(({ seriesId, period, draft }) => saveCell(seriesId, period, draft!)));
        continue;
      }
      return current.every(({ draft }) => !draft || draft.status === 'saved');
    }
  }, [saveCell]);

  const editCell = useCallback((series: KpiWidgetSeries, point: KpiPoint, field: 'value' | 'comment', value: string) => {
    const key = cellKey(series.seriesId, point.periodStart);
    const current = draftsRef.current[key] ?? {
      value: point.value ?? '',
      comment: point.comment ?? '',
      expectedUpdatedAt: point.updatedAt,
      status: 'saved' as const,
      revision: 0,
    };
    const next: CellDraft = { ...current, [field]: value, status: 'dirty', revision: current.revision + 1 };
    setCellDraft(key, next);
    if (savingCells.current.has(key)) editsDuringSave.current.set(key, next);
    const scheduledTimer = draftSaveTimers.current.get(key);
    if (scheduledTimer !== undefined) window.clearTimeout(scheduledTimer);
    const timer = window.setTimeout(() => {
      draftSaveTimers.current.delete(key);
      void saveCell(series.seriesId, point.periodStart, next);
    }, 500);
    draftSaveTimers.current.set(key, timer);
  }, [saveCell, setCellDraft]);

  const retryCell = useCallback(async (seriesId: string, periodStart: string) => {
    const key = cellKey(seriesId, periodStart);
    const current = draftsRef.current[key];
    if (!current) return;
    if (current.status === 'conflict' && current.latestServerValue === undefined) {
      const currentDashboardId = dashboardIdRef.current;
      if (!currentDashboardId) return;
      const latest = await refreshDashboard(currentDashboardId);
      if (!latest || dashboardIdRef.current !== currentDashboardId) return;
      const currentPoint = latest.widgets.flatMap((widget) => widget.series)
        .find((series) => series.seriesId === seriesId)?.points.find((point) => point.periodStart === periodStart);
      if (!currentPoint) return;
      const freshest = draftsRef.current[key] ?? current;
      setCellDraft(key, {
        ...freshest,
        expectedUpdatedAt: currentPoint.updatedAt,
        latestServerValue: currentPoint.value,
        latestServerComment: currentPoint.comment,
        status: 'conflict',
      });
      return;
    }
    const next: CellDraft = {
      ...current,
      status: 'dirty',
      revision: current.revision + 1,
    };
    setCellDraft(key, next);
    void saveCell(seriesId, periodStart, next);
  }, [refreshDashboard, saveCell, setCellDraft]);

  async function submitDepartment(event: FormEvent) {
    event.preventDefault();
    if (!newDepartmentName.trim() || departmentSaving) return;
    if (hasUnsavedCells && !window.confirm(m.kpiUnsavedLeave)) return;
    setDepartmentSaving(true);
    try {
      const created = await createKpiDepartment(newDepartmentName.trim(), null);
      setNewDepartmentName('');
      rootDepartmentDetails.current?.removeAttribute('open');
      writeKpiRoute(created.departmentId, null);
      const latest = await refreshWorkspace();
      setDepartmentId(created.departmentId);
      setDashboardId(null);
      setExpandedDepartmentIds((current) => new Set(current).add(created.departmentId));
      if (!latest?.some((item) => item.departmentId === created.departmentId)) {
        setDepartments((current) => [...current, { ...created, dashboards: [] }]);
      }
    } catch (error) {
      handleRequestError(error);
      setWorkspaceError(true);
    } finally {
      setDepartmentSaving(false);
    }
  }

  async function submitChildDepartment(event: FormEvent, parentDepartmentId: string) {
    event.preventDefault();
    if (!newChildDepartmentName.trim() || departmentSaving) return;
    if (hasUnsavedCells && !window.confirm(m.kpiUnsavedLeave)) return;
    setDepartmentSaving(true);
    try {
      const created = await createKpiDepartment(newChildDepartmentName.trim(), parentDepartmentId);
      setNewChildDepartmentName('');
      setCreatingChildDepartmentId(null);
      writeKpiRoute(created.departmentId, null);
      await refreshWorkspace();
      setDepartmentId(created.departmentId);
      setDashboardId(null);
      setExpandedDepartmentIds((current) => new Set(current).add(parentDepartmentId));
    } catch (error) {
      handleRequestError(error);
      setWorkspaceError(true);
    } finally {
      setDepartmentSaving(false);
    }
  }

  async function submitDepartmentEdit(event: FormEvent, department: KpiDepartment) {
    event.preventDefault();
    if (!editingDepartmentName.trim() || departmentSaving) return;
    setDepartmentSaving(true);
    setDepartmentEditError(false);
    try {
      await updateKpiDepartment(department.departmentId, {
        name: editingDepartmentName.trim(),
        emoji: editingDepartmentEmoji || null,
        color: editingDepartmentColor || null,
        parentDepartmentId: editingDepartmentParentId || null,
      });
      await refreshWorkspace();
      if (editingDepartmentParentId) {
        setExpandedDepartmentIds((current) => new Set(current).add(editingDepartmentParentId));
      }
      setEditingDepartmentId(null);
    } catch (error) {
      handleRequestError(error);
      setDepartmentEditError(true);
    } finally {
      setDepartmentSaving(false);
    }
  }

  async function removeDepartment(department: DepartmentTreeNode) {
    if (departmentSaving || departmentDeleteTypedName.trim() !== department.name) return;
    const deletingDepartmentIds = getDepartmentDescendantIds(department.departmentId, departments);
    deletingDepartmentIds.add(department.departmentId);
    const removesSelectedDepartment = Boolean(departmentId && deletingDepartmentIds.has(departmentId));
    if (removesSelectedDepartment && hasUnsavedCells && !window.confirm(m.kpiUnsavedLeave)) return;
    setDepartmentDeleteError(false);
    setDepartmentSaving(true);
    try {
      await deleteKpiDepartment(department.departmentId, departmentDeleteTypedName.trim());
      setDepartments((current) => current.filter((item) => !deletingDepartmentIds.has(item.departmentId)));
      setExpandedDepartmentIds((current) => new Set([...current].filter((id) => !deletingDepartmentIds.has(id))));
      if (removesSelectedDepartment) {
        const fallbackDepartmentId = department.parentDepartmentId && !deletingDepartmentIds.has(department.parentDepartmentId)
          ? department.parentDepartmentId
          : departments.find((item) => !deletingDepartmentIds.has(item.departmentId) && !item.parentDepartmentId)?.departmentId ?? null;
        writeKpiRoute(fallbackDepartmentId, null);
        setDepartmentId(fallbackDepartmentId);
        setDashboardId(null);
        setDashboard(null);
        setDashboardState('idle');
        setDashboardError(false);
      }
      setDepartmentDeleteTarget(null);
      setDepartmentDeleteTypedName('');
    } catch (error) {
      handleRequestError(error);
      setDepartmentDeleteError(true);
    } finally {
      setDepartmentSaving(false);
    }
  }

  async function removeDashboard(
    departmentId: string,
    item: KpiDepartment['dashboards'][number],
  ) {
    if (deletingDashboardId) return;
    if (dashboardId === item.dashboardId && hasUnsavedCells && !window.confirm(m.kpiUnsavedLeave)) return;
    if (!window.confirm(m.kpiConfirmDeleteDashboard.replace('{name}', item.name))) return;
    setDashboardDeleteError(null);
    setDeletingDashboardId(item.dashboardId);
    try {
      await deleteKpiDashboard(item.dashboardId);
      setDepartments((current) => current.map((department) => department.departmentId !== departmentId
        ? department
        : { ...department, dashboards: department.dashboards.filter((dashboardItem) => dashboardItem.dashboardId !== item.dashboardId) }));
      if (dashboardId === item.dashboardId) {
        writeKpiRoute(departmentId, null);
        setDashboardId(null);
        setDashboard(null);
        setDashboardState('idle');
        setDashboardError(false);
      }
    } catch (error) {
      handleRequestError(error);
      setDashboardDeleteError(item.dashboardId);
    } finally {
      setDeletingDashboardId(null);
    }
  }

  async function reorderDepartment(department: KpiDepartment, offset: -1 | 1) {
    const ordered = departments
      .filter((item) => item.parentDepartmentId === department.parentDepartmentId)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
    const from = ordered.findIndex((item) => item.departmentId === department.departmentId);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= ordered.length) return;
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);
    try {
      await Promise.all(ordered.map((item, index) => updateKpiDepartment(item.departmentId, { sortOrder: index })));
      const sortOrders = new Map(ordered.map((item, index) => [item.departmentId, index]));
      setDepartments((current) => current.map((item) => sortOrders.has(item.departmentId)
        ? { ...item, sortOrder: sortOrders.get(item.departmentId) ?? item.sortOrder }
        : item));
    } catch (error) {
      handleRequestError(error);
      setWorkspaceError(true);
      await refreshWorkspace();
    }
  }

  async function submitDashboardDetails(event: FormEvent) {
    event.preventDefault();
    if (!dashboardId || !dashboardNameDraft.trim() || dashboardInfoSaving) return;
    setDashboardInfoSaving(true);
    setDashboardInfoError(false);
    try {
      await updateKpiDashboard(dashboardId, {
        name: dashboardNameDraft.trim(),
        description: dashboardDescriptionDraft.trim() || null,
      });
      await Promise.all([refreshDashboard(dashboardId), refreshWorkspace()]);
    } catch (error) {
      handleRequestError(error);
      setDashboardInfoError(true);
    } finally {
      setDashboardInfoSaving(false);
    }
  }

  function beginWidgetEdit(widget: KpiWidget) {
    setEditingWidgetId(widget.widgetId);
    setWidgetTitleDraft(widget.title);
    setWidgetDescriptionDraft(widget.description ?? '');
    setWidgetSeriesDraft(widget.series.map((item) => item.seriesId));
    setWidgetEditError(false);
  }

  async function submitWidgetEdit(event: FormEvent, widget: KpiWidget) {
    event.preventDefault();
    const editedChoices = widgetSeriesDraft.map((id) => seriesChoices.find((item) => item.seriesId === id)).filter((item): item is SeriesChoice => Boolean(item));
    if (!widgetTitleDraft.trim() || validateKpiSeries(editedChoices) !== null || widgetEditSaving) return;
    setWidgetEditSaving(true);
    setWidgetEditError(false);
    try {
      await updateKpiWidget(widget.widgetId, {
        title: widgetTitleDraft.trim(),
        description: widgetDescriptionDraft.trim() || null,
        seriesIds: widgetSeriesDraft,
      });
      setEditingWidgetId(null);
      if (dashboardId) {
        const refreshed = await refreshDashboard(dashboardId);
        if (refreshed) await persistExplicitDashboardLayout(refreshed);
      }
    } catch (error) {
      handleRequestError(error);
      setWidgetEditError(true);
    } finally {
      setWidgetEditSaving(false);
    }
  }

  async function applyRange(clear = false) {
    if (!dashboardId || rangeSaving) return;
    const start = clear ? null : rangeStart || null;
    const end = clear ? null : rangeEnd || null;
    if ((start === null) !== (end === null) || (start && end && start > end)) {
      setRangeError(true);
      return;
    }
    setRangeSaving(true);
    setRangeError(false);
    try {
      await updateKpiDashboard(dashboardId, { rangeStart: start, rangeEnd: end });
      await refreshDashboard(dashboardId);
    } catch (error) {
      handleRequestError(error);
      setRangeError(true);
    } finally {
      setRangeSaving(false);
    }
  }

  function toggleDepartmentExpanded(nextId: string) {
    setExpandedDepartmentIds((current) => {
      const next = new Set(current);
      if (next.has(nextId)) next.delete(nextId);
      else next.add(nextId);
      return next;
    });
  }

  function changeDepartment(nextId: string) {
    if (nextId === departmentId) return;
    if (hasUnsavedCells && !window.confirm(m.kpiUnsavedLeave)) return;
    setValueEntryWidgetId(null);
    draftsRef.current = {};
    setDrafts({});
    writeKpiRoute(nextId, null);
    setDepartmentId(nextId);
    setDashboardId(null);
  }

  function openDashboard(nextDepartmentId: string, nextDashboardId: string) {
    if (nextDashboardId === dashboardId && nextDepartmentId === departmentId) return;
    if (hasUnsavedCells && !window.confirm(m.kpiUnsavedLeave)) return;
    setValueEntryWidgetId(null);
    draftsRef.current = {};
    setDrafts({});
    writeKpiRoute(nextDepartmentId, nextDashboardId);
    setDepartmentId(nextDepartmentId);
    setDashboardId(nextDashboardId);
    setExpandedDepartmentIds((current) => new Set(current).add(nextDepartmentId));
  }

  function completeWidgetMoveDrop(preview: KpiWidgetMovePreview, session: KpiWidgetMoveSession) {
    const originalLayout = session.originalLayout.map((widget) => ({ ...widget }));
    setWidgetMovePreviewWithFlip({ ...preview, active: false });
    void persistKpiLayout(session.dashboardId, preview.layout, {
      onSuccess: (widgets) => {
        const confirmedLayouts = snapshotKpiWidgetLayouts(widgets);
        if (dashboardIdRef.current !== session.dashboardId) return;
        setDashboard((current) => current?.dashboardId === session.dashboardId
          ? {
            ...current,
            widgets: current.widgets.map((widget) => {
              const confirmed = confirmedLayouts.get(widget.widgetId);
              return confirmed ? { ...widget, ...confirmed } : widget;
            }),
          }
          : current);
        setWidgetMovePreviewWithFlip(null);
      },
      onFailure: {
        rollbackLocal: () => {
          setWidgetMovePreviewWithFlip(null);
          setDashboard((current) => current?.dashboardId === session.dashboardId
            ? { ...current, widgets: originalLayout }
            : current);
        },
        refreshAfterCompensation: async () => {
          await refreshDashboard(session.dashboardId);
          if (dashboardIdRef.current === session.dashboardId) {
            setDashboardError(true);
            setDashboardState('error');
          }
        },
      },
    });
  }

  function startWidgetMove(event: ReactPointerEvent<HTMLElement>, widget: KpiWidget) {
    if (!isAdmin || !event.isPrimary || event.button !== 0 || !['mouse', 'pen'].includes(event.pointerType)) return;
    if (dashboard && (layoutWriteQueuesRef.current.has(dashboard.dashboardId)
      || (layoutWritesInFlightRef.current.get(dashboard.dashboardId) ?? 0) > 0)) return;
    if (widgetMoveSessionRef.current) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('button, a, input, select, textarea, summary, .kpi-chart-point, .kpi-axis-label, .kpi-widget-resize-handle')) return;
    if (window.getSelection()?.toString()) return;

    const element = event.currentTarget.closest('.kpi-widget') as HTMLElement | null;
    const grid = element?.closest('.kpi-widget-grid') as HTMLElement | null;
    if (!element || !grid || !dashboard || gridContainerWidth <= 0) return;
    const bounds = element.getBoundingClientRect();
    const session: KpiWidgetMoveSession = {
      widgetId: widget.widgetId,
      dashboardId: dashboard.dashboardId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      grabOffsetX: event.clientX - bounds.left,
      grabOffsetY: event.clientY - bounds.top,
      width: bounds.width,
      height: bounds.height,
      originalLayout: visibleWidgetLayout.map((item) => ({ ...item })),
      originalPreview: widgetMovePreview,
      addTilePosition: visibleAddTilePosition ? { ...visibleAddTilePosition } : null,
      element,
      active: false,
      frameId: null,
    };
    widgetMoveSessionRef.current = session;

    const updatePreview = (clientX: number, clientY: number): KpiWidgetMovePreview => {
      const left = clientX - session.grabOffsetX;
      const top = clientY - session.grabOffsetY;
      const activeGrid = session.element.closest('.kpi-widget-grid') as HTMLElement | null;
      if (!activeGrid) {
        return {
          widgetId: session.widgetId,
          layout: session.originalLayout,
          candidate: null,
          left,
          top,
          width: session.width,
          height: session.height,
          addTilePosition: session.addTilePosition,
          active: true,
        };
      }

      const gridBounds = activeGrid.getBoundingClientRect();
      const gridStyles = window.getComputedStyle(activeGrid);
      const borderLeft = Number.parseFloat(gridStyles.borderLeftWidth) || 0;
      const borderRight = Number.parseFloat(gridStyles.borderRightWidth) || 0;
      const borderTop = Number.parseFloat(gridStyles.borderTopWidth) || 0;
      const borderBottom = Number.parseFloat(gridStyles.borderBottomWidth) || 0;
      const paddingLeft = Number.parseFloat(gridStyles.paddingLeft) || 0;
      const paddingRight = Number.parseFloat(gridStyles.paddingRight) || 0;
      const paddingTop = Number.parseFloat(gridStyles.paddingTop) || 0;
      const paddingBottom = Number.parseFloat(gridStyles.paddingBottom) || 0;
      const gridLeft = gridBounds.left + borderLeft + paddingLeft;
      const gridTop = gridBounds.top + borderTop + paddingTop;
      const containerWidth = Math.max(0, gridBounds.width - borderLeft - borderRight - paddingLeft - paddingRight);
      const containerHeight = Math.max(0, gridBounds.height - borderTop - borderBottom - paddingTop - paddingBottom);
      const pointTarget = document.elementFromPoint(clientX, clientY);
      const targetCard = pointTarget?.closest<HTMLElement>('[data-kpi-widget-id]') ?? null;
      const targetWidgetId = targetCard?.dataset.kpiWidgetId ?? null;
      const overAddTile = Boolean(pointTarget?.closest('.kpi-add-widget-tile'));
      const isOverCardInGrid = Boolean(targetCard && activeGrid.contains(targetCard));
      const isNarrowGrid = window.matchMedia('(max-width: 700px)').matches;

      if (targetWidgetId && targetWidgetId !== session.widgetId && isOverCardInGrid) {
        const moved = moveKpiWidgetBeforeTarget(session.originalLayout, session.widgetId, targetWidgetId);
        if (moved) {
          return {
            widgetId: session.widgetId,
            layout: isNarrowGrid
              ? moved
              : packKpiPreviewLayout(moved, containerWidth || gridContainerWidthRef.current, session.addTilePosition),
            candidate: { kind: 'before', targetWidgetId },
            left,
            top,
            width: session.width,
            height: session.height,
            addTilePosition: session.addTilePosition,
            active: true,
          };
        }
      }

      const insideGrid = clientX >= gridLeft
        && clientX <= gridLeft + containerWidth
        && clientY >= gridTop
        && clientY <= gridTop + containerHeight;
      if (insideGrid && !overAddTile && !isNarrowGrid) {
        const dragged = session.originalLayout.find((item) => item.widgetId === session.widgetId);
        if (dragged) {
          const columnGap = Number.parseFloat(gridStyles.columnGap) || KPI_GRID_ROW_GAP_PX;
          const columnWidth = (containerWidth - columnGap * 11) / 12;
          const columnStep = columnWidth + columnGap;
          const desired = {
            gridX: Math.round((left - gridLeft) / columnStep),
            gridY: Math.round((top - gridTop) / KPI_GRID_ROW_STEP_PX),
          };
          const placed = placeKpiWidgetAtGridPosition(
            session.originalLayout,
            session.widgetId,
            desired,
            containerWidth || gridContainerWidthRef.current,
            session.addTilePosition,
          );
          if (placed) {
            return {
              widgetId: session.widgetId,
              layout: placed.layout,
              candidate: { kind: 'grid', position: placed.position },
              left,
              top,
              width: session.width,
              height: session.height,
              addTilePosition: session.addTilePosition,
              active: true,
            };
          }
        }
      }

      return {
        widgetId: session.widgetId,
        layout: session.originalLayout,
        candidate: null,
        left,
        top,
        width: session.width,
        height: session.height,
        addTilePosition: session.addTilePosition,
        active: true,
      };
    };

    const clearSession = () => {
      cleanupKpiWidgetMoveSession(session);
      if (widgetMoveSessionRef.current === session) widgetMoveSessionRef.current = null;
    };

    const finishSession = (kind: 'up' | 'cancel', pointerEvent?: PointerEvent) => {
      if (widgetMoveSessionRef.current !== session) return;
      if (pointerEvent && pointerEvent.pointerId !== session.pointerId) return;
      if (!session.active) {
        clearSession();
        return;
      }
      if (kind === 'up' && pointerEvent) {
        if (session.frameId !== null) {
          window.cancelAnimationFrame(session.frameId);
          session.frameId = null;
        }
        session.currentX = pointerEvent.clientX;
        session.currentY = pointerEvent.clientY;
        const preview = updatePreview(session.currentX, session.currentY);
        if (preview.candidate) completeWidgetMoveDrop(preview, session);
        else setWidgetMovePreviewWithFlip(session.originalPreview);
      } else {
        setWidgetMovePreviewWithFlip(session.originalPreview);
      }
      clearSession();
    };

    const onPointerMove = (pointerEvent: PointerEvent) => {
      if (widgetMoveSessionRef.current !== session || pointerEvent.pointerId !== session.pointerId) return;
      session.currentX = pointerEvent.clientX;
      session.currentY = pointerEvent.clientY;
      if (!session.active) {
        const moved = Math.hypot(session.currentX - session.startX, session.currentY - session.startY);
        if (moved < KPI_WIDGET_MOVE_ACTIVATION_PX) return;
        if (window.getSelection()?.toString()) {
          finishSession('cancel');
          return;
        }
        session.active = true;
        session.element.setPointerCapture(session.pointerId);
        setWidgetMovePreviewWithFlip({
          widgetId: session.widgetId,
          layout: session.originalLayout,
          candidate: null,
          left: session.currentX - session.grabOffsetX,
          top: session.currentY - session.grabOffsetY,
          width: session.width,
          height: session.height,
          addTilePosition: session.addTilePosition,
          active: true,
        });
      }
      pointerEvent.preventDefault();
      if (session.frameId !== null) return;
      session.frameId = window.requestAnimationFrame(() => {
        session.frameId = null;
        if (widgetMoveSessionRef.current !== session || !session.active) return;
        const preview = updatePreview(session.currentX, session.currentY);
        setWidgetMovePreviewWithFlip(preview);
      });
    };

    const onPointerUp = (pointerEvent: PointerEvent) => finishSession('up', pointerEvent);
    const onPointerCancel = (pointerEvent: PointerEvent) => finishSession('cancel', pointerEvent);
    const onKeyDown = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key !== 'Escape') return;
      keyboardEvent.preventDefault();
      finishSession('cancel');
    };
    session.cleanup = () => {
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerCancel, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerCancel, true);
    window.addEventListener('keydown', onKeyDown, true);
  }

  function startWidgetResize(event: ReactPointerEvent<HTMLButtonElement>, widget: KpiWidget, direction: KpiWidgetResizeDirection) {
    event.preventDefault();
    event.stopPropagation();
    const element = event.currentTarget.closest('.kpi-widget') as HTMLElement | null;
    const grid = event.currentTarget.closest('.kpi-widget-grid') as HTMLElement | null;
    if (!element || !grid) return;
    const gridStyle = window.getComputedStyle(grid);
    const columnGap = Number.parseFloat(gridStyle.columnGap) || 0;
    const containerWidth = grid.getBoundingClientRect().width;
    const columnStep = (containerWidth - columnGap * 11) / 12 + columnGap;
    const bounds = element.getBoundingClientRect();
    const draft = {
      widgetId: widget.widgetId,
      gridWidth: widget.gridWidth,
      gridHeight: widget.gridHeight,
      pixelWidth: bounds.width,
      pixelHeight: bounds.height,
    };
    widgetResizeDragRef.current = {
      ...draft,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startGridWidth: widget.gridWidth,
      startGridHeight: widget.gridHeight,
      columnStep,
      containerWidth,
      startWidthPx: bounds.width,
      startHeightPx: bounds.height,
      direction,
      element,
      initialStyle: {
        width: element.style.width,
        height: element.style.height,
        transform: element.style.transform,
        gridColumn: element.style.gridColumn,
      },
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    element.classList.add('is-resizing');
  }

  function moveWidgetResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = widgetResizeDragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const horizontalDelta = event.clientX - drag.startX;
    const verticalDelta = event.clientY - drag.startY;
    const changesWidth = drag.direction.includes('e') || drag.direction.includes('w');
    const changesHeight = drag.direction.includes('n') || drag.direction.includes('s');
    const horizontalSign = drag.direction.includes('w') ? -1 : 1;
    const verticalSign = drag.direction.includes('n') ? -1 : 1;
    const isNarrowLayout = window.matchMedia('(max-width: 940px)').matches;
    const widthDelta = changesWidth && !isNarrowLayout ? horizontalDelta * horizontalSign : 0;
    const heightDelta = changesHeight ? verticalDelta * verticalSign : 0;
    const minimumWidth = Math.max(40, drag.startWidthPx + (3 - drag.startGridWidth) * drag.columnStep);
    const maximumWidth = drag.startWidthPx + (12 - drag.startGridWidth) * drag.columnStep;
    drag.pixelWidth = Math.max(minimumWidth, Math.min(maximumWidth, drag.startWidthPx + widthDelta));
    drag.pixelHeight = Math.max(250, Math.min(drag.startHeightPx + (12 - drag.startGridHeight) * 52, drag.startHeightPx + heightDelta));
    drag.gridWidth = changesWidth && !isNarrowLayout
      ? Math.max(3, Math.min(12, drag.startGridWidth + Math.round(widthDelta / drag.columnStep)))
      : drag.startGridWidth;
    drag.gridHeight = changesHeight
      ? Math.max(2, Math.min(12, drag.startGridHeight + Math.round(heightDelta / 52)))
      : drag.startGridHeight;
    const translateX = drag.direction.includes('w') ? drag.startWidthPx - drag.pixelWidth : 0;
    const translateY = drag.direction.includes('n') ? drag.startHeightPx - drag.pixelHeight : 0;
    drag.element.style.width = `${drag.pixelWidth}px`;
    drag.element.style.height = `${drag.pixelHeight}px`;
    drag.element.style.transform = `translate(${translateX}px, ${translateY}px)`;
  }

  async function finishWidgetResize(event: ReactPointerEvent<HTMLButtonElement>, save: boolean) {
    const drag = widgetResizeDragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    widgetResizeDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.element.classList.remove('is-resizing');
    if (!save || !dashboard || (drag.gridWidth === drag.startGridWidth && drag.gridHeight === drag.startGridHeight)) {
      Object.assign(drag.element.style, drag.initialStyle);
      return;
    }
    const widget = dashboard.widgets.find((item) => item.widgetId === drag.widgetId);
    if (!widget) {
      Object.assign(drag.element.style, drag.initialStyle);
      return;
    }
    const targetWidth = Math.max(40, drag.startWidthPx + (drag.gridWidth - drag.startGridWidth) * drag.columnStep);
    const targetHeight = Math.max(250, 204 + (drag.gridWidth / 12 * 0.322 * drag.containerWidth) + (drag.gridHeight - 4) * 52);
    const draft = { widgetId: drag.widgetId, gridWidth: drag.gridWidth, gridHeight: drag.gridHeight, pixelWidth: targetWidth, pixelHeight: targetHeight };
    setWidgetResizeDraft(draft);
    await updateWidgetSize(widget, drag.gridWidth, drag.gridHeight);
    window.setTimeout(() => setWidgetResizeDraft((current) => current?.widgetId === drag.widgetId ? null : current), 180);
  }

  async function updateWidgetSize(widget: KpiWidget, gridWidth: number, gridHeight?: number): Promise<boolean> {
    const dashboardIdToUpdate = dashboardRef.current?.dashboardId;
    if (!dashboardIdToUpdate || dashboardIdToUpdate !== dashboard?.dashboardId) return false;

    let resolvedWidgets: readonly KpiWidget[] | null = null;
    const getResolvedWidgets = (): readonly KpiWidget[] | null => resolvedWidgets;
    const saved = await persistKpiLayout(dashboardIdToUpdate, (currentLayouts) => {
      const currentDashboard = dashboardRef.current;
      const containerWidth = getKpiContentWidth(gridContentRef.current) || gridContainerWidthRef.current;
      if (!currentDashboard || currentDashboard.dashboardId !== dashboardIdToUpdate || containerWidth <= 0) return null;

      const widgetsWithCurrentLayouts = currentDashboard.widgets.map((item) => {
        const currentLayout = currentLayouts.get(item.widgetId);
        return currentLayout ? { ...item, ...currentLayout } : item;
      });
      const layoutWidgets = normalizeKpiGridLayout(widgetsWithCurrentLayouts, containerWidth);
      const resizedWidget = layoutWidgets.find((item) => item.widgetId === widget.widgetId);
      if (!resizedWidget) return null;
      const nextGridHeight = gridHeight ?? resizedWidget.gridHeight;

      const gridItems = getKpiGridItems(layoutWidgets, containerWidth);
      const occupied = gridItems
        .filter((item) => item.widgetId !== widget.widgetId)
        .map(({ gridX, gridY, gridWidth: occupiedWidth, rowSpan }) => ({
          gridX,
          gridY,
          gridWidth: occupiedWidth,
          rowSpan,
        }));
      const addTilePosition = getKpiAddTilePosition(gridItems);
      if (addTilePosition) {
        occupied.push({
          ...addTilePosition,
          gridWidth: 6,
          rowSpan: Math.ceil((264 + KPI_GRID_ROW_GAP_PX) / KPI_GRID_ROW_STEP_PX),
        });
      }

      const position = findNearestKpiGridPosition(
        gridWidth,
        getKpiGridRowSpan(gridWidth, nextGridHeight, containerWidth),
        resizedWidget,
        occupied,
      );
      resolvedWidgets = layoutWidgets.map((item) => item.widgetId === widget.widgetId
        ? { ...item, ...position, gridWidth, gridHeight: nextGridHeight }
        : item);
      return resolvedWidgets;
    });
    const resolved = getResolvedWidgets();
    if (!saved || !resolved) return false;

    const layoutsByWidgetId = new Map(resolved.map((item) => [item.widgetId, item] as const));
    setDashboard((current) => current?.dashboardId === dashboardIdToUpdate
      ? {
        ...current,
        widgets: current.widgets.map((item) => {
          const layout = layoutsByWidgetId.get(item.widgetId);
          return layout ? {
            ...item,
            gridX: layout.gridX,
            gridY: layout.gridY,
            gridWidth: layout.gridWidth,
            gridHeight: layout.gridHeight,
            sortOrder: layout.sortOrder,
          } : item;
        }),
      }
      : current);
    return true;
  }

  async function updateLayout(widget: KpiWidget, patch: Partial<Pick<KpiWidget, 'sortOrder' | 'gridWidth' | 'gridHeight' | 'periodCount' | 'showLinearTrend' | 'showMovingAverage'>> & { seriesColors?: Record<string, string | null> }): Promise<boolean> {
    try {
      await updateKpiWidget(widget.widgetId, patch);
      if (dashboardId) await refreshDashboard(dashboardId, { quiet: true });
      return true;
    } catch (error) {
      handleRequestError(error);
      setDashboardError(true);
      return false;
    }
  }

  async function saveWidgetSeriesColor(widget: KpiWidget, seriesId: string, draftKey: string, color: string | null, menu: HTMLDetailsElement | null) {
    if (await updateLayout(widget, { seriesColors: { [seriesId]: color } })) {
      clearWidgetSeriesColorDraft(draftKey);
      menu?.setAttribute('open', '');
    }
  }

  function clearWidgetSeriesColorDraft(draftKey: string) {
    setWidgetSeriesColorDrafts((current) => {
      const next = { ...current };
      delete next[draftKey];
      return next;
    });
  }

  async function removeWidget(widget: KpiWidget) {
    if (!window.confirm(m.kpiConfirmDeleteWidget)) return;
    try {
      await deleteKpiWidget(widget.widgetId);
      setDashboard((current) => current
        ? { ...current, widgets: current.widgets.filter((item) => item.widgetId !== widget.widgetId) }
        : current);
    } catch (error) {
      handleRequestError(error);
      setDashboardError(true);
    }
  }

  const departmentTree = buildDepartmentTree(departments);
  const dashboardSearchTerm = dashboardSearch.trim().toLocaleLowerCase();
  const dashboardCount = departments.reduce((count, department) => count + department.dashboards.length, 0);
  const matchingDashboardCount = departments.reduce((count, department) => count + department.dashboards.filter((item) =>
    item.name.toLocaleLowerCase().includes(dashboardSearchTerm)).length, 0);

  function departmentContainsDashboardMatch(department: DepartmentTreeNode): boolean {
    if (!dashboardSearchTerm) return true;
    return department.dashboards.some((item) => item.name.toLocaleLowerCase().includes(dashboardSearchTerm))
      || department.children.some(departmentContainsDashboardMatch);
  }

  function beginChildDepartment(departmentId: string) {
    setCreateDashboardDepartmentId(null);
    setCreatingChildDepartmentId(departmentId);
    setNewChildDepartmentName('');
    setExpandedDepartmentIds((current) => new Set(current).add(departmentId));
  }

  function beginDashboardCreation(departmentId: string) {
    if (hasUnsavedCells && !window.confirm(m.kpiUnsavedLeave)) return;
    setCreatingChildDepartmentId(null);
    setCreateDashboardDepartmentId(departmentId);
    setExpandedDepartmentIds((current) => new Set(current).add(departmentId));
  }

  function openAddWidgetDialog(targetDepartmentId: string, targetDashboardId: string, targetDashboardName: string, widget?: KpiWidget) {
    const department = departments.find((item) => item.departmentId === targetDepartmentId);
    if (!department) return;
    setSettingsWidget(widget ?? null);
    setEditingWidgetId(null);
    setAddWidgetContext({
      departmentId: targetDepartmentId,
      departmentPath: getDepartmentPathLabel(targetDepartmentId, departments),
      dashboardId: targetDashboardId,
      dashboardName: targetDashboardName,
    });
    setExpandedDepartmentIds((current) => new Set(current).add(department.departmentId));
  }

  function addDashboardCreated(created: KpiDashboardSummary) {
    setDepartments((current) => current.map((department) => {
      if (department.departmentId !== created.departmentId
        || department.dashboards.some((dashboardItem) => dashboardItem.dashboardId === created.dashboardId)) return department;
      return { ...department, dashboards: [...department.dashboards, created] };
    }));
    writeKpiRoute(created.departmentId, created.dashboardId);
    setDepartmentId(created.departmentId);
    setDashboardId(created.dashboardId);
    setExpandedDepartmentIds((current) => new Set(current).add(created.departmentId));
  }

  function addWidgetDefinitionCreated(created: KpiDefinition) {
    setDefinitions((current) => current.some((definition) => definition.definitionId === created.definitionId)
      ? current
      : [...current, created]);
  }

  async function completeAddWidget(targetDashboardId: string) {
    const targetDepartmentId = addWidgetContext?.departmentId;
    if (!targetDepartmentId) return;
    writeKpiRoute(targetDepartmentId, targetDashboardId);
    setDepartmentId(targetDepartmentId);
    setDashboardId(targetDashboardId);
    void refreshWorkspace();
    try {
      setDefinitions(await loadKpiDefinitions(targetDepartmentId));
    } catch (error) {
      handleRequestError(error);
    }
    const refreshed = await refreshDashboard(targetDashboardId);
    if (refreshed) await persistExplicitDashboardLayout(refreshed);
    setAddWidgetContext(null);
    setSettingsWidget(null);
  }

  function dismissAddWidgetDialog(createdDefinitionId: string | null) {
    const context = addWidgetContext;
    if (!context) return;
    setAddWidgetContext(null);
    setSettingsWidget(null);
    if (!createdDefinitionId) return;
    void loadKpiDefinitions(context.departmentId)
      .then(setDefinitions)
      .catch(handleRequestError);
    void refreshDashboard(context.dashboardId);
  }

  function renderDepartmentNode(department: DepartmentTreeNode, depth: number): ReactNode {
    const childIds = getDepartmentDescendantIds(department.departmentId, departments);
    const parentOptions = departments
      .filter((item) => item.departmentId !== department.departmentId && !childIds.has(item.departmentId))
      .sort((left, right) => getDepartmentPathLabel(left.departmentId, departments).localeCompare(getDepartmentPathLabel(right.departmentId, departments)));
    const siblings = departments
      .filter((item) => item.parentDepartmentId === department.parentDepartmentId)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
    const siblingIndex = siblings.findIndex((item) => item.departmentId === department.departmentId);
    const matchedDashboards = department.dashboards.filter((item) => item.name.toLocaleLowerCase().includes(dashboardSearchTerm));
    const visibleChildren = department.children.filter(departmentContainsDashboardMatch);
    const hasItems = visibleChildren.length > 0 || matchedDashboards.length > 0;
    const isExpanded = expandedDepartmentIds.has(department.departmentId) || Boolean(dashboardSearchTerm);

    return (
      <li
        className={depth === 0 ? 'kpi-tree-node is-department-root' : 'kpi-tree-node is-nested-folder'}
        key={department.departmentId}
        style={{ '--kpi-folder-color': department.color ? departmentColorValues[department.color] : undefined } as CSSProperties}
      >
        <div
          className={department.departmentId === departmentId ? 'kpi-department-row is-active' : 'kpi-department-row'}
          style={{ paddingLeft: String(depth * 16) + 'px', '--tree-guide-offset': String(depth * 16 + 10) + 'px' } as CSSProperties}
        >
          <button
            className="kpi-tree-toggle"
            type="button"
            aria-label={isExpanded ? m.kpiCollapseDepartment : m.kpiExpandDepartment}
            aria-expanded={isExpanded}
            disabled={!hasItems}
            onClick={() => toggleDepartmentExpanded(department.departmentId)}
          >
            {hasItems ? (isExpanded ? '⌄' : '›') : ''}
          </button>
          <button
            className="kpi-department"
            type="button"
            aria-pressed={department.departmentId === departmentId}
            onClick={() => {
              changeDepartment(department.departmentId);
              setExpandedDepartmentIds((current) => new Set(current).add(department.departmentId));
            }}
          >
            {department.emoji ? (
              <span className="kpi-tree-folder-emoji" aria-hidden="true">{department.emoji}</span>
            ) : depth === 0 ? (
              <svg className="kpi-tree-type-icon is-department" viewBox="0 0 16 16" aria-hidden="true">
                <rect x="3" y="1.75" width="10" height="12.5" rx="1.25" />
                <path d="M6 4.5h1M9 4.5h1M6 7h1M9 7h1M7.5 14v-3h1v3" />
              </svg>
            ) : (
              <svg className="kpi-tree-type-icon is-folder" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M1.75 4.5A1.25 1.25 0 0 1 3 3.25h3.25L7.75 5H13a1.25 1.25 0 0 1 1.25 1.25v5.25A1.25 1.25 0 0 1 13 12.75H3a1.25 1.25 0 0 1-1.25-1.25z" />
                <path d="M2.25 6.75h11.5" />
              </svg>
            )}
            <span className="kpi-department-name">{department.name}</span>
            <span className="kpi-count">{department.dashboards.length}</span>
          </button>
          {isAdmin && <details className="kpi-tree-actions" onToggle={(event) => placeDepartmentActionsMenu(event.currentTarget)}>
            <summary className="kpi-icon-button" aria-label={m.kpiDepartmentActions}>⋯</summary>
            <div className="kpi-tree-actions-menu">
              <button type="button" onClick={(event) => {
                event.currentTarget.closest('details')?.removeAttribute('open');
                beginChildDepartment(department.departmentId);
              }}>{m.kpiAddChildDepartment}</button>
              <button type="button" onClick={(event) => {
                event.currentTarget.closest('details')?.removeAttribute('open');
                beginDashboardCreation(department.departmentId);
              }}>{m.kpiCreateDashboard}</button>
              <button type="button" disabled={siblingIndex <= 0} onClick={(event) => {
                event.currentTarget.closest('details')?.removeAttribute('open');
                void reorderDepartment(department, -1);
              }}>{m.kpiMoveUp}</button>
              <button type="button" disabled={siblingIndex < 0 || siblingIndex >= siblings.length - 1} onClick={(event) => {
                event.currentTarget.closest('details')?.removeAttribute('open');
                void reorderDepartment(department, 1);
              }}>{m.kpiMoveDown}</button>
              <button type="button" onClick={(event) => {
                event.currentTarget.closest('details')?.removeAttribute('open');
                setEditingDepartmentId(department.departmentId);
                setEditingDepartmentName(department.name);
                setEditingDepartmentParentId(department.parentDepartmentId ?? '');
                setEditingDepartmentEmoji(department.emoji ?? '');
                setEditingDepartmentColor(department.color ?? '');
                setDepartmentEditError(false);
              }}>{m.kpiEditDepartment}</button>
              <button className="is-danger" type="button" disabled={departmentSaving} onClick={(event) => {
                event.currentTarget.closest('details')?.removeAttribute('open');
                setDepartmentDeleteTarget(department);
                setDepartmentDeleteTypedName('');
                setDepartmentDeleteError(false);
              }}>{m.kpiDeleteDepartment}</button>
            </div>
          </details>}
        </div>
        {isAdmin && creatingChildDepartmentId === department.departmentId && <form className="kpi-rail-form kpi-tree-form" onSubmit={(event) => void submitChildDepartment(event, department.departmentId)}>
          <label htmlFor={`kpi-child-department-${department.departmentId}`}>{m.kpiAddChildDepartment}</label>
          <div className="kpi-form-row">
            <input id={`kpi-child-department-${department.departmentId}`} autoFocus value={newChildDepartmentName} maxLength={120} onChange={(event) => setNewChildDepartmentName(event.target.value)} />
            <button className="kpi-icon-button" type="submit" aria-label={m.kpiCreateDepartment} disabled={departmentSaving || !newChildDepartmentName.trim()}>+</button>
          </div>
          {departmentSaving && <span className="kpi-muted">{m.kpiCreating}</span>}
        </form>}

        {isAdmin && editingDepartmentId === department.departmentId && <form className="kpi-rail-form kpi-tree-form" onSubmit={(event) => void submitDepartmentEdit(event, department)}>
          <label htmlFor={`kpi-department-name-${department.departmentId}`}>{m.kpiEditDepartment}
            <input id={`kpi-department-name-${department.departmentId}`} autoFocus value={editingDepartmentName} maxLength={120} onChange={(event) => setEditingDepartmentName(event.target.value)} />
          </label>
          <label htmlFor={`kpi-department-parent-${department.departmentId}`}>{m.kpiDepartmentParent}
            <select id={`kpi-department-parent-${department.departmentId}`} value={editingDepartmentParentId} onChange={(event) => setEditingDepartmentParentId(event.target.value)}>
              <option value="">{m.kpiNoParentDepartment}</option>
              {parentOptions.map((item) => <option value={item.departmentId} key={item.departmentId}>{getDepartmentPathLabel(item.departmentId, departments)}</option>)}
            </select>
          </label>
          <label htmlFor={`kpi-department-emoji-${department.departmentId}`}>{m.kpiFolderEmoji}
            <select id={`kpi-department-emoji-${department.departmentId}`} value={editingDepartmentEmoji} onChange={(event) => setEditingDepartmentEmoji(event.target.value)}>
              <option value="">{m.kpiFolderEmojiDefault}</option>
              {departmentEmojiOptions.map((emoji) => <option value={emoji} key={emoji}>{emoji}</option>)}
            </select>
          </label>
          <label htmlFor={`kpi-department-color-${department.departmentId}`}>{m.kpiFolderColor}
            <select id={`kpi-department-color-${department.departmentId}`} value={editingDepartmentColor} onChange={(event) => setEditingDepartmentColor(event.target.value as KpiDepartmentColor | '')}>
              <option value="">{m.kpiFolderColorDefault}</option>
              <option value="blue">{m.kpiFolderColorBlue}</option>
              <option value="teal">{m.kpiFolderColorTeal}</option>
              <option value="green">{m.kpiFolderColorGreen}</option>
              <option value="amber">{m.kpiFolderColorAmber}</option>
              <option value="rose">{m.kpiFolderColorRose}</option>
              <option value="violet">{m.kpiFolderColorViolet}</option>
            </select>
          </label>
          {departmentEditError && <span className="kpi-field-error" role="alert">{m.kpiEditError}</span>}
          <div className="kpi-form-row">
            <button className="button" type="submit" disabled={departmentSaving || !editingDepartmentName.trim()}>{m.kpiSaveChanges}</button>
            <button className="kpi-text-button" type="button" onClick={() => setEditingDepartmentId(null)}>{m.kpiCancelEdit}</button>
          </div>
        </form>}

        {isExpanded && hasItems && <ul className="kpi-tree-children" style={{ '--tree-guide-offset': String((depth + 1) * 16 + 10) + 'px' } as CSSProperties}>
          {visibleChildren.map((child) => renderDepartmentNode(child, depth + 1))}
          {matchedDashboards.map((item) => (
            <li className="kpi-tree-dashboard" key={item.dashboardId}>
              <div className="kpi-dashboard-row" style={{ paddingLeft: `${31 + depth * 16}px` }}>
                <button
                  type="button"
                  className={dashboardId === item.dashboardId ? 'kpi-dashboard-link is-active' : 'kpi-dashboard-link'}
                  aria-current={dashboardId === item.dashboardId ? 'page' : undefined}
                  onClick={() => openDashboard(department.departmentId, item.dashboardId)}
                >
                  <svg className="kpi-dashboard-mark" viewBox="0 0 16 16" aria-hidden="true">
                    <rect x="1.5" y="2" width="13" height="11.5" rx="2" />
                    <path d="m4 10 2.4-2.5 2 1.7 3.6-4" />
                  </svg>
                  <span>{item.name}</span>
                </button>
                {isAdmin && <details className="kpi-tree-actions" onToggle={(event) => placeDepartmentActionsMenu(event.currentTarget)}>
                  <summary className="kpi-icon-button" aria-label={m.kpiDashboardActions}>⋯</summary>
                  <div className="kpi-tree-actions-menu">
                    <button className="is-danger" type="button" disabled={deletingDashboardId === item.dashboardId} onClick={(event) => {
                      event.currentTarget.closest('details')?.removeAttribute('open');
                      void removeDashboard(department.departmentId, item);
                    }}>{m.kpiDeleteDashboard}</button>
                  </div>
                </details>}
              </div>
              {dashboardDeleteError === item.dashboardId && <p className="kpi-tree-error" role="alert">{m.kpiDeleteDashboardError}</p>}
            </li>
          ))}
        </ul>}
      </li>
    );
  }

  return (
    <section id="kpi" className="kpi-page" aria-labelledby="kpi-page-title">
      <div className={isRailCollapsed ? 'kpi-workspace is-rail-collapsed' : 'kpi-workspace'}>
        <aside className={isRailCollapsed ? 'kpi-rail is-collapsed' : 'kpi-rail'} aria-label={m.kpiDepartments}>
          <div className="kpi-rail-heading">
            <div className="kpi-rail-heading-copy" aria-hidden={isRailCollapsed}>
              <span className="section-kicker">{m.kpiDepartments}</span>
              <span className="kpi-count">{departments.length}</span>
            </div>
            <button
              className="kpi-icon-button kpi-rail-toggle"
              type="button"
              aria-label={isRailCollapsed ? m.expandSidebar : m.collapseSidebar}
              aria-expanded={!isRailCollapsed}
              onClick={() => setIsRailCollapsed((current) => !current)}
            >{isRailCollapsed ? '›' : '‹'}</button>
          </div>
          <div className="kpi-rail-content-shell" aria-hidden={isRailCollapsed} inert={isRailCollapsed}>
            <div className="kpi-rail-content">
              {workspaceState === 'loading' ? <p className="kpi-muted">{m.kpiLoading}</p> : null}
              {workspaceState === 'error' && workspaceError ? (
                <div className="kpi-error-inline" role="alert">
                  <span>{m.kpiLoadError}</span>
                  <button className="kpi-text-button" type="button" onClick={() => void refreshWorkspace()}>{m.retry}</button>
                </div>
              ) : null}
              {departments.length === 0 && workspaceState === 'ready' && <p className="kpi-muted">{m.kpiNoDepartments}</p>}
              {dashboardCount > 3 && <label className="kpi-search-field">
                <span>{m.kpiSearchDashboard}</span>
                <input type="search" value={dashboardSearch} onChange={(event) => setDashboardSearch(event.target.value)} placeholder={m.kpiSearchDashboard} />
              </label>}
              {dashboardSearchTerm && matchingDashboardCount === 0 && <p className="kpi-muted">{m.kpiNoDashboardResults}</p>}
              {isAdmin && <details ref={rootDepartmentDetails} className="kpi-create-folder">
                <summary><span aria-hidden="true">+</span>{m.kpiAddDepartment}</summary>
                <form className="kpi-create-folder-form" onSubmit={(event) => void submitDepartment(event)}>
                  <label htmlFor="kpi-new-department">{m.kpiDepartmentName}</label>
                  <div className="kpi-form-row">
                    <input id="kpi-new-department" value={newDepartmentName} maxLength={120} onChange={(event) => setNewDepartmentName(event.target.value)} />
                    <button className="kpi-icon-button" type="submit" aria-label={m.kpiCreateDepartment} disabled={departmentSaving || !newDepartmentName.trim()}>↵</button>
                  </div>
                  {departmentSaving && <span className="kpi-muted">{m.kpiCreating}</span>}
                </form>
              </details>}
              <ul className="kpi-department-list" aria-label={m.kpiDepartments}>
                {departmentTree.filter(departmentContainsDashboardMatch).map((department) => renderDepartmentNode(department, 0))}
              </ul>
            </div>
          </div>
        </aside>

        <div className="kpi-content" ref={gridContentRef}>
          {!selectedDepartment ? null : !dashboardId ? (
            <div className="kpi-empty-workspace">
              {isAdmin && <button
                className="kpi-empty-add-widget"
                type="button"
                onClick={() => beginDashboardCreation(selectedDepartment.departmentId)}
              >
                <span aria-hidden="true">+</span>
                {m.kpiCreateDashboard}
              </button>}
            </div>
          ) : dashboardState === 'loading' ? (
            <div className="kpi-load-state" role="status">{m.kpiLoading}</div>
          ) : dashboardState === 'error' || dashboardError ? (
            <div className="kpi-load-state" role="alert">
              <p>{m.kpiLoadError}</p>
              <button className="button" type="button" onClick={() => dashboardId && void refreshDashboard(dashboardId)}>{m.retry}</button>
            </div>
          ) : dashboard ? (
            <>
              <div className="kpi-dashboard-heading">
                <div>
                  <span className="section-kicker">{dashboard.department.name}</span>
                  <h2>{dashboard.name}</h2>
                  {dashboard.description && <p>{dashboard.description}</p>}
                  {isAdmin && <details className="kpi-edit-details">
                    <summary>{m.kpiEditDashboard}</summary>
                    <form className="kpi-create-form" onSubmit={(event) => void submitDashboardDetails(event)}>
                      <label>{m.kpiDashboardName}<input value={dashboardNameDraft} maxLength={160} onChange={(event) => setDashboardNameDraft(event.target.value)} /></label>
                      <label>{m.kpiDescription}<textarea rows={2} value={dashboardDescriptionDraft} onChange={(event) => setDashboardDescriptionDraft(event.target.value)} /></label>
                      {dashboardInfoError && <span className="kpi-field-error" role="alert">{m.kpiEditError}</span>}
                      <button className="button" type="submit" disabled={dashboardInfoSaving || !dashboardNameDraft.trim()}>{dashboardInfoSaving ? m.kpiSaving : m.kpiSaveChanges}</button>
                    </form>
                  </details>}
                </div>
                {isAdmin && <div className="kpi-range-controls">
                  <button
                    className="button kpi-add-widget-dashboard-trigger"
                    type="button"
                    onClick={() => openAddWidgetDialog(dashboard.department.departmentId, dashboard.dashboardId, dashboard.name)}
                  >{m.kpiAddWidget}</button>
                  <label>
                    <span>{m.kpiStartDate}</span>
                    <input type="date" value={rangeStart} onChange={(event) => { setRangeStart(event.target.value); setRangeError(false); }} />
                  </label>
                  <label>
                    <span>{m.kpiEndDate}</span>
                    <input type="date" value={rangeEnd} onChange={(event) => { setRangeEnd(event.target.value); setRangeError(false); }} />
                  </label>
                  <button className="button button-secondary" type="button" disabled={rangeSaving} onClick={() => void applyRange()}>{rangeSaving ? m.kpiSaving : m.kpiApplyRange}</button>
                  {(dashboard.rangeStart || dashboard.rangeEnd) && <button className="kpi-text-button" type="button" onClick={() => { setRangeStart(''); setRangeEnd(''); void applyRange(true); }}>{m.kpiRecentPeriods}</button>}
                  {rangeError && <span className="kpi-field-error" role="alert">{m.kpiInvalidRange}</span>}
                </div>}
              </div>

              {dashboard.widgets.length === 0 ? (
                <div className="kpi-empty-chart-state">
                  <p>{m.kpiDashboardEmpty}</p>
                  <small>{m.kpiDashboardEmptyHint}</small>
                  {isAdmin && <button className="button button-secondary" type="button" onClick={() => openAddWidgetDialog(dashboard.department.departmentId, dashboard.dashboardId, dashboard.name)}>{m.kpiAddWidget}</button>}
                </div>
              ) : gridContainerWidth <= 0 ? (
                <div className="kpi-load-state" role="status">{m.kpiLoading}</div>
              ) : (
                <div
                  className={widgetMovePreview?.active ? 'kpi-widget-grid is-widget-moving' : 'kpi-widget-grid'}
                  ref={widgetGridRef}
                >
                  {visibleWidgetLayout.map((widget) => {
                    const isActiveMove = widgetMovePreview?.active === true && widgetMovePreview.widgetId === widget.widgetId;
                    const effectiveGridWidth = widgetResizeDraft?.widgetId === widget.widgetId ? widgetResizeDraft.gridWidth : widget.gridWidth;
                    const effectiveGridHeight = widgetResizeDraft?.widgetId === widget.widgetId ? widgetResizeDraft.gridHeight : widget.gridHeight;
                    const gridColumn = `${widget.gridX + 1} / span ${effectiveGridWidth}`;
                    const gridRow = `${widget.gridY + 1} / span ${getKpiGridRowSpan(effectiveGridWidth, effectiveGridHeight, gridContainerWidth)}`;
                    const gridBounds = isActiveMove ? widgetGridRef.current?.getBoundingClientRect() : null;
                    const gridStyle = isActiveMove && widgetGridRef.current ? window.getComputedStyle(widgetGridRef.current) : null;
                    const fixedOriginLeft = (gridBounds?.left ?? 0) + (Number.parseFloat(gridStyle?.borderLeftWidth ?? '0') || 0);
                    const fixedOriginTop = (gridBounds?.top ?? 0) + (Number.parseFloat(gridStyle?.borderTopWidth ?? '0') || 0);
                    const widgetStyle = {
                      gridColumn: isActiveMove ? 'auto' : gridColumn,
                      gridRow: isActiveMove ? 'auto' : gridRow,
                      '--kpi-widget-height-basis': `${(effectiveGridWidth / 12 * 32.2).toFixed(2)}cqi`,
                      '--kpi-widget-height-adjustment': `${(effectiveGridHeight - 4) * 52}px`,
                      height: isActiveMove
                        ? `${widgetMovePreview?.height ?? 0}px`
                        : widgetResizeDraft?.widgetId === widget.widgetId
                          ? `${widgetResizeDraft.pixelHeight}px`
                          : 'calc(204px + var(--kpi-widget-height-basis) + var(--kpi-widget-height-adjustment))',
                      width: isActiveMove
                        ? `${widgetMovePreview?.width ?? 0}px`
                        : widgetResizeDraft?.widgetId === widget.widgetId ? `${widgetResizeDraft.pixelWidth}px` : undefined,
                      transform: widgetResizeDraft?.widgetId === widget.widgetId && !isActiveMove ? 'translate(0, 0)' : undefined,
                      minHeight: '250px',
                      ...(isActiveMove ? {
                        position: 'fixed',
                        left: `${(widgetMovePreview?.left ?? 0) - fixedOriginLeft}px`,
                        top: `${(widgetMovePreview?.top ?? 0) - fixedOriginTop}px`,
                        zIndex: 9999,
                        pointerEvents: 'none',
                      } : {}),
                    } as CSSProperties;
                    return <Fragment key={widget.widgetId}>
                      {isActiveMove && <div
                        className="kpi-widget-move-placeholder"
                        aria-hidden="true"
                        style={{ gridColumn, gridRow, width: `${widgetMovePreview?.width ?? 0}px`, height: `${widgetMovePreview?.height ?? 0}px` }}
                      />}
                      <article
                      data-kpi-widget-id={widget.widgetId}
                      className={`kpi-widget${isAdmin ? ' is-draggable' : ''}${isActiveMove ? ' is-active-move' : ''}${widgetResizeDraft?.widgetId === widget.widgetId ? ' is-snapping' : ''}${selectedWidgetId === widget.widgetId ? ' is-copy-selected' : ''}`}
                      style={widgetStyle}
                      tabIndex={isAdmin ? 0 : undefined}
                      aria-keyshortcuts={isAdmin ? 'Control+C Meta+C Control+V Meta+V' : undefined}
                      onFocusCapture={isAdmin ? () => setSelectedWidgetId(widget.widgetId) : undefined}
                      onClick={isAdmin ? () => setSelectedWidgetId(widget.widgetId) : undefined}
                      onPointerDown={isAdmin ? (event) => { setSelectedWidgetId(widget.widgetId); startWidgetMove(event, widget); } : undefined}
                    >
                      <div className="kpi-widget-heading">
                        <div className="kpi-widget-title-group">
                          {isAdmin && <span
                            className="kpi-drag-grip"
                            role="img"
                            aria-label={m.kpiMoveWidget}
                            title={m.kpiMoveWidget}
                          >⠿</span>}
                          <div><h3>{widget.title}</h3>{widget.description && <p>{widget.description}</p>}</div>
                        </div>
                        {isAdmin && <div className="kpi-widget-actions">
                          <details className="kpi-widget-menu">
                            <summary className="kpi-icon-button" aria-label={m.kpiWidgetOptions} title={m.kpiWidgetOptions}>⋯</summary>
                            <div className="kpi-widget-menu-popover">
                              <button type="button" onClick={(event) => {
                                event.currentTarget.closest('details')?.removeAttribute('open');
                                beginWidgetEdit(widget);
                              }}>{m.kpiEditChart}</button>
                              <label className="kpi-widget-menu-control"><span>{m.kpiWidgetWidth}</span><select value={widget.gridWidth} onChange={(event) => void updateWidgetSize(widget, Number(event.target.value))}>
                                {Array.from({ length: 10 }, (_, widthIndex) => widthIndex + 3).map((width) => <option value={width} key={width}>{width === 6 ? m.kpiHalfWidth : width === 12 ? m.kpiFullWidth : `${width}/12`}</option>)}
                              </select></label>
                              <label className="kpi-widget-menu-control"><span>{m.kpiPeriods}</span><select value={widget.periodCount} onChange={(event) => void updateLayout(widget, { periodCount: Number(event.target.value) })}>
                                {[4, 8, 12, 16, 24, 36, 52, 60].map((count) => <option value={count} key={count}>{count}</option>)}
                              </select></label>
                              <label className="kpi-widget-menu-checkbox"><input type="checkbox" checked={widget.showLinearTrend} onChange={(event) => void updateLayout(widget, { showLinearTrend: event.target.checked })} /><span>{m.kpiLinearTrend}</span></label>
                              <label className="kpi-widget-menu-checkbox"><input type="checkbox" checked={widget.showMovingAverage} onChange={(event) => void updateLayout(widget, { showMovingAverage: event.target.checked })} /><span>{m.kpiMovingAverage}</span></label>
                              <div className="kpi-widget-menu-divider" />
                              <div className="kpi-widget-menu-colors">
                                <strong>{m.kpiLineColors}</strong>
                                {widget.series.map((series) => {
                                  const draftKey = `${widget.widgetId}:${series.seriesId}`;
                                  const hasDraft = Object.prototype.hasOwnProperty.call(widgetSeriesColorDrafts, draftKey);
                                  const draftColor = widgetSeriesColorDrafts[draftKey];
                                  const color = hasDraft ? draftColor ?? risingLineColor : series.color ?? risingLineColor;
                                  const isAutomatic = hasDraft ? draftColor === null : series.color === null;
                                  return <div className="kpi-widget-menu-color" key={series.seriesId}>
                                    <span title={series.label}>{series.label}</span>
                                    <small>{isAutomatic ? m.kpiLineColorAutomatic : m.kpiLineColorSolid}</small>
                                    <input type="color" aria-label={m.kpiLineColor.replace('{name}', series.label)} value={color} onChange={(event) => {
                                      setWidgetSeriesColorDrafts((current) => ({ ...current, [draftKey]: event.target.value }));
                                      event.currentTarget.closest('details')?.setAttribute('open', '');
                                    }} />
                                    {hasDraft && <button className="is-save" type="button" onClick={(event) => void saveWidgetSeriesColor(widget, series.seriesId, draftKey, draftColor ?? null, event.currentTarget.closest('details'))}>{m.kpiSaveLineColor}</button>}
                                    {hasDraft && <button className="is-cancel" type="button" aria-label={m.kpiCancelEdit} title={m.kpiCancelEdit} onClick={(event) => {
                                      clearWidgetSeriesColorDraft(draftKey);
                                      event.currentTarget.closest('details')?.setAttribute('open', '');
                                    }}>×</button>}
                                    <button className="is-reset" type="button" aria-label={m.kpiResetLineColor} title={m.kpiResetLineColor} onClick={(event) => {
                                      setWidgetSeriesColorDrafts((current) => ({ ...current, [draftKey]: null }));
                                      event.currentTarget.closest('details')?.setAttribute('open', '');
                                    }}>↺</button>
                                  </div>;
                                })}
                              </div>
                              <div className="kpi-widget-menu-divider" />
                              <button type="button" onClick={(event) => {
                                event.currentTarget.closest('details')?.removeAttribute('open');
                                openAddWidgetDialog(dashboard.department.departmentId, dashboard.dashboardId, dashboard.name, widget);
                              }}>{m.kpiWidgetSettings}</button>
                              <div className="kpi-widget-menu-divider" />
                              <button className="is-danger" type="button" onClick={(event) => {
                                event.currentTarget.closest('details')?.removeAttribute('open');
                                void removeWidget(widget);
                              }}>{m.kpiDeleteWidget}</button>
                            </div>
                          </details>
                        </div>}
                      </div>
                      {isAdmin && editingWidgetId === widget.widgetId && <form className="kpi-widget-edit-form" onSubmit={(event) => void submitWidgetEdit(event, widget)}>
                        <label>{m.kpiWidgetTitle}<input value={widgetTitleDraft} maxLength={160} onChange={(event) => setWidgetTitleDraft(event.target.value)} /></label>
                        <label>{m.kpiDescription}<textarea rows={2} value={widgetDescriptionDraft} onChange={(event) => setWidgetDescriptionDraft(event.target.value)} /></label>
                        <div className="kpi-series-picker" aria-label={m.kpiSelectTwoSeries}>
                          {widgetEditSeriesChoices.map((choice) => <label className="kpi-series-option" key={choice.seriesId}>
                            <input type="checkbox" checked={widgetSeriesDraft.includes(choice.seriesId)} disabled={!widgetSeriesDraft.includes(choice.seriesId) && widgetSeriesDraft.length >= 10} onChange={() => setWidgetSeriesDraft((current) => current.includes(choice.seriesId) ? current.filter((id) => id !== choice.seriesId) : current.length >= 10 ? current : [...current, choice.seriesId])} />
                            <span><strong>{choice.label}</strong><small>{choice.definitionName} · {choice.unit} · {choice.cadence}</small></span>
                          </label>)}
                        </div>
                        {widgetEditValidation !== null && <span className="kpi-field-error">{getKpiSeriesValidationMessage(m, widgetEditValidation)}</span>}
                        {widgetEditError && <span className="kpi-field-error" role="alert">{m.kpiEditError}</span>}
                        <div className="kpi-form-row"><button className="button" type="submit" disabled={widgetEditSaving || widgetEditValidation !== null}>{widgetEditSaving ? m.kpiSaving : m.kpiSaveChanges}</button><button className="kpi-text-button" type="button" onClick={() => setEditingWidgetId(null)}>{m.kpiCancelEdit}</button></div>
                      </form>}
                      <KpiChart widget={widget} locale={locale} emptyLabel={m.kpiNoValues} currentLabel={m.kpiCurrentPeriod} leftLabel={m.kpiAxisLeft} rightLabel={m.kpiAxisRight} linearTrendLabel={m.kpiLinearTrend} movingAverageLabel={m.kpiMovingAverage} trendRisingLabel={m.kpiTrendRising} trendFallingLabel={m.kpiTrendFalling} />
                      <div className="kpi-widget-entry-action">
                        <button
                          className="button button-secondary"
                          type="button"
                          aria-haspopup="dialog"
                          aria-controls="kpi-values-dialog"
                          onClick={() => setValueEntryWidgetId(widget.widgetId)}
                        >
                          {m.kpiEnterValues}
                        </button>
                      </div>
                      {isAdmin && (['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const).map((direction) => <button
                        className={`kpi-widget-resize-handle is-${direction}`}
                        type="button"
                        key={direction}
                        aria-label={m.kpiResizeWidget}
                        aria-hidden="true"
                        tabIndex={-1}
                        title={m.kpiResizeWidget}
                        onPointerDown={(event) => startWidgetResize(event, widget, direction)}
                        onPointerMove={moveWidgetResize}
                        onPointerUp={(event) => void finishWidgetResize(event, true)}
                        onPointerCancel={(event) => void finishWidgetResize(event, false)}
                      />)}
                    </article>
                    </Fragment>;
                  })}
                  {isAdmin && visibleAddTilePosition && <button
                    className="kpi-add-widget-tile"
                    type="button"
                    aria-haspopup="dialog"
                    style={{
                      gridColumn: `${visibleAddTilePosition.gridX + 1} / span 6`,
                      gridRow: `${visibleAddTilePosition.gridY + 1} / span ${Math.ceil((264 + KPI_GRID_ROW_GAP_PX) / KPI_GRID_ROW_STEP_PX)}`,
                    }}
                    onClick={() => openAddWidgetDialog(dashboard.department.departmentId, dashboard.dashboardId, dashboard.name)}
                  >
                    <span aria-hidden="true">+</span>
                    <strong>{m.kpiAddWidget}</strong>
                  </button>}
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
      <KpiValueDialog
        widget={valueEntryWidget}
        locale={locale}
        messages={m}
        drafts={drafts}
        onEditCell={editCell}
        onSaveCell={saveCell}
        onRetryCell={retryCell}
        onSaveValues={saveWidgetValues}
        onClose={() => setValueEntryWidgetId(null)}
      />
      {isAdmin && createDashboardDepartmentId && <KpiCreateDashboardDialog
        departmentId={createDashboardDepartmentId}
        departmentPath={getDepartmentPathLabel(createDashboardDepartmentId, departments)}
        messages={m}
        onCreated={addDashboardCreated}
        onDismiss={() => setCreateDashboardDepartmentId(null)}
        onRequestError={handleRequestError}
      />}
      {isAdmin && addWidgetContext && <KpiAddWidgetDialog
        context={addWidgetContext}
        definitions={definitions}
        editingWidget={settingsWidget ?? undefined}
        layoutWidgets={dialogLayoutWidgets}
        gridContainerWidth={gridContainerWidth}
        layoutReady={dialogLayoutReady}
        locale={locale}
        messages={m}
        onDefinitionCreated={addWidgetDefinitionCreated}
        onCompleted={completeAddWidget}
        onDismiss={dismissAddWidgetDialog}
        onRequestError={handleRequestError}
      />}
      {departmentDeleteTarget && <div className="kpi-delete-dialog-backdrop">
        <form
          className="kpi-delete-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="kpi-delete-folder-title"
          onSubmit={(event) => {
            event.preventDefault();
            void removeDepartment(departmentDeleteTarget);
          }}
        >
          <h2 id="kpi-delete-folder-title">{m.kpiDeleteDepartment}</h2>
          <p>{m.kpiConfirmDeleteDepartment.replace('{name}', departmentDeleteTarget.name)}</p>
          <label htmlFor="kpi-delete-folder-name">{m.kpiTypeDepartmentName.replace('{name}', departmentDeleteTarget.name)}
            <input
              id="kpi-delete-folder-name"
              autoFocus
              value={departmentDeleteTypedName}
              onChange={(event) => setDepartmentDeleteTypedName(event.target.value)}
              autoComplete="off"
            />
          </label>
          {departmentDeleteError && <p className="kpi-field-error" role="alert">{m.kpiDeleteDepartmentError}</p>}
          <div className="kpi-form-row">
            <button className="kpi-text-button" type="button" disabled={departmentSaving} onClick={() => {
              setDepartmentDeleteTarget(null);
              setDepartmentDeleteTypedName('');
            }}>{m.kpiCancelEdit}</button>
            <button
              className="button is-danger"
              type="submit"
              disabled={departmentSaving || departmentDeleteTypedName.trim() !== departmentDeleteTarget.name}
            >{m.kpiDeleteDepartment}</button>
          </div>
        </form>
      </div>}
    </section>
  );
}


type KpiValueTableProps = {
  widget: KpiWidget;
  locale: string;
  messages: Messages;
  drafts: Record<string, CellDraft>;
  onEditCell: (series: KpiWidgetSeries, point: KpiPoint, field: 'value' | 'comment', value: string) => void;
  onSaveCell: (seriesId: string, periodStart: string, draft: CellDraft) => void | Promise<void>;
  onRetryCell: (seriesId: string, periodStart: string) => void | Promise<void>;
};

type KpiValueDialogProps = Omit<KpiValueTableProps, 'widget'> & {
  widget: KpiWidget | null;
  onSaveValues: (widget: KpiWidget) => Promise<boolean>;
  onClose: () => void;
};

const KpiValueTable = memo(function KpiValueTable({
  widget,
  locale,
  messages: m,
  drafts,
  onEditCell,
  onSaveCell,
  onRetryCell,
}: KpiValueTableProps) {
  return (
    <>
      <div className="kpi-table-heading"><h4>{m.kpiDataEntry}</h4></div>
      <div className="kpi-table-scroller">
        <table className="kpi-values-table">
          <thead><tr><th scope="col">{m.kpiPeriodLabel}</th>{widget.series.map((series) => <th scope="col" key={series.seriesId}><span>{series.label}</span><small>{series.name} · {series.unit}</small></th>)}</tr></thead>
          <tbody>{widget.periods.map((period) => {
            const firstPoint = widget.series[0]?.points.find((point) => point.periodStart === period);
            return (
              <tr className={firstPoint?.isCurrentPeriod ? 'is-current-period' : undefined} key={period}>
                <th scope="row"><span>{formatPeriod(period, widget.series[0]?.cadence ?? 'week', locale)}</span>{firstPoint?.isCurrentPeriod && <small className="kpi-current-badge">{m.kpiCurrentPeriod}</small>}</th>
                {widget.series.map((series) => {
                  const point = series.points.find((item) => item.periodStart === period) ?? { periodStart: period, value: null, comment: null, updatedAt: null, isCurrentPeriod: false };
                  const key = cellKey(series.seriesId, period);
                  const draft = drafts[key] ?? {
                    value: point.value ?? '',
                    comment: point.comment ?? '',
                    expectedUpdatedAt: point.updatedAt,
                    status: 'saved' as const,
                    revision: 0,
                  };
                  const statusText = draft.status === 'saving' ? m.kpiSaving : draft.status === 'saved' ? m.kpiSaved : draft.status === 'conflict' ? m.kpiConflict : draft.status === 'error' ? (draft.value.trim() ? m.kpiSaveFailed : m.kpiValueRequired) : '';
                  return (
                    <td key={series.seriesId}>
                      <div className="kpi-cell-editors">
                        <input
                          className="kpi-number-input"
                          type="number"
                          step={10 ** -series.precision}
                          value={draft.value}
                          aria-label={`${series.label} · ${formatPeriod(period, series.cadence, locale)} · ${series.unit}`}
                          onChange={(event) => onEditCell(series, point, 'value', event.target.value)}
                          onBlur={() => void onSaveCell(series.seriesId, period, drafts[key] ?? draft)}
                        />
                        <textarea
                          value={draft.comment}
                          rows={1}
                          placeholder={m.kpiComment}
                          aria-label={`${m.kpiComment} · ${series.label} · ${formatPeriod(period, series.cadence, locale)}`}
                          onChange={(event) => onEditCell(series, point, 'comment', event.target.value)}
                          onBlur={() => void onSaveCell(series.seriesId, period, drafts[key] ?? draft)}
                        />
                        {(drafts[key] !== undefined || draft.status !== 'saved') && (
                          <span className={`kpi-cell-status is-${draft.status}`} role={draft.status === 'error' || draft.status === 'conflict' ? 'alert' : 'status'}>{statusText}</span>
                        )}
                        {draft.status === 'conflict' && draft.latestServerValue !== undefined && <small className="kpi-cell-conflict-current">
                          {m.kpiLatestServerValue}: {draft.latestServerValue ?? '—'}{draft.latestServerComment ? ` · ${m.kpiComment}: ${draft.latestServerComment}` : ''}
                        </small>}
                        {(draft.status === 'error' || draft.status === 'conflict') && (
                          <button className="kpi-text-button" type="button" onClick={() => void onRetryCell(series.seriesId, period)}>{draft.status === 'conflict' && draft.latestServerValue === undefined ? m.kpiLoadLatest : m.kpiRetry}</button>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </>
  );
}, (previous, next) => {
  if (
    previous.widget !== next.widget
    || previous.locale !== next.locale
    || previous.messages !== next.messages
    || previous.onEditCell !== next.onEditCell
    || previous.onSaveCell !== next.onSaveCell
    || previous.onRetryCell !== next.onRetryCell
  ) return false;
  for (const series of previous.widget.series) {
    for (const period of previous.widget.periods) {
      const key = cellKey(series.seriesId, period);
      if (previous.drafts[key] !== next.drafts[key]) return false;
    }
  }
  return true;
});

const KpiValueDialog = memo(function KpiValueDialog({
  widget,
  locale,
  messages: m,
  drafts,
  onEditCell,
  onSaveCell,
  onRetryCell,
  onSaveValues,
  onClose,
}: KpiValueDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [savingValues, setSavingValues] = useState(false);
  async function saveAndClose() {
    if (!widget || savingValues) return;
    setSavingValues(true);
    try {
      if (await onSaveValues(widget)) dialogRef.current?.close();
    } finally {
      setSavingValues(false);
    }
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (widget && !dialog.open) dialog.showModal();
    else if (!widget && dialog.open) dialog.close();
  }, [widget]);

  return (
    <dialog
      ref={dialogRef}
      className="kpi-values-dialog"
      id="kpi-values-dialog"
      aria-labelledby="kpi-values-dialog-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
    >
      {widget && (
        <div className="kpi-values-dialog-content">
          <div className="kpi-values-dialog-heading">
            <h2 id="kpi-values-dialog-title">{widget.title}</h2>
            <div className="kpi-values-dialog-actions">
              <button className="button" type="button" disabled={savingValues} onClick={() => void saveAndClose()}>
                {savingValues ? m.kpiSaving : m.kpiSaveValues}
              </button>
              <button className="button button-secondary" type="button" disabled={savingValues} onClick={() => dialogRef.current?.close()}>
                {m.kpiClose}
              </button>
            </div>
          </div>
          <KpiValueTable
            widget={widget}
            locale={locale}
            messages={m}
            drafts={drafts}
            onEditCell={onEditCell}
            onSaveCell={onSaveCell}
            onRetryCell={onRetryCell}
          />
        </div>
      )}
    </dialog>
  );
});

const KpiChart = memo(function KpiChart({
  widget,
  locale,
  emptyLabel,
  currentLabel,
  leftLabel,
  rightLabel,
  linearTrendLabel,
  movingAverageLabel,
  trendRisingLabel,
  trendFallingLabel,
}: {
  widget: KpiWidget;
  locale: string;
  emptyLabel: string;
  currentLabel: string;
  leftLabel: string;
  rightLabel: string;
  linearTrendLabel: string;
  movingAverageLabel: string;
  trendRisingLabel: string;
  trendFallingLabel: string;
}) {
  const width = 720;
  const height = 232;
  const left = 48;
  const right = 48;
  const top = 18;
  const bottom = 34;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const plotClipId = `kpi-chart-plot-${widget.widgetId}`;
  const chartSeries = widget.series.map((series) => {
    const points = widget.periods.map((period) => series.points.find((point) => point.periodStart === period) ?? { periodStart: period, value: null, comment: null, updatedAt: null, isCurrentPeriod: false });
    const values = points.map((point) => point.value);
    return {
      series,
      points,
      linearTrend: widget.showLinearTrend ? getLinearTrendSegment(values) : null,
      movingAverage: widget.showMovingAverage ? getMovingAverageValues(values) : values.map(() => null),
    };
  });
  const allValues = chartSeries.flatMap(({ points }) => points.map((point) => point.value));
  const hasValues = getNumericExtent(allValues) !== null;
  const extentValues = (items: typeof chartSeries) => items.flatMap(({ points }) =>
    points.map((point) => point.value),
  );
  const extents = {
    left: getNumericExtent(extentValues(chartSeries.filter(({ series }) => series.axisSide === 'left'))),
    right: getNumericExtent(extentValues(chartSeries.filter(({ series }) => series.axisSide === 'right'))),
  };
  const formatValue = (value: string | null, precision: number) => {
    const number = parseKpiNumber(value);
    if (number === null) return '—';
    return new Intl.NumberFormat(locale, { maximumFractionDigits: precision }).format(number);
  };
  const [activePoint, setActivePoint] = useState<{
    series: KpiWidgetSeries;
    point: KpiPoint;
    color: string;
    x: number;
    y: number;
  } | null>(null);
  const [hoveredPeriodIndex, setHoveredPeriodIndex] = useState<number | null>(null);
  const hoveredPeriodBand = hoveredPeriodIndex === null ? null : (() => {
    const step = widget.periods.length > 1 ? plotWidth / (widget.periods.length - 1) : plotWidth;
    const center = xPosition(hoveredPeriodIndex, widget.periods.length, left, plotWidth);
    const x = Math.max(left, center - step / 2);
    const rightEdge = Math.min(width - right, center + step / 2);
    return { x, width: Math.max(0, rightEdge - x) };
  })();
  const tooltipSide = activePoint?.x !== undefined && activePoint.x > width * 0.8
    ? 'is-right'
    : activePoint && activePoint.x < width * 0.2
      ? 'is-left'
      : '';
  const tooltipVertical = activePoint && activePoint.y < height * 0.24 ? 'is-below' : '';

  return (
    <div className="kpi-chart-block">
      <div className={`kpi-chart-axes${widget.showMovingAverage ? ' has-moving-average' : ''}`}>
        {[...new Set(widget.series.map((series) => `${series.axisSide}:${series.unit}`))].map((item) => {
          const [side, unit] = item.split(':');
          return <span className={`kpi-axis-tag is-${side}`} key={item}><b>{side === 'right' ? rightLabel : leftLabel}</b> {unit}</span>;
        })}
        {widget.showMovingAverage && <span className="kpi-chart-moving-average-label" title={movingAverageLabel}><i aria-hidden="true" /><span>{movingAverageLabel}</span></span>}
      </div>
      {!hasValues ? <div className="kpi-chart-empty">{emptyLabel}</div> : (
        <div className="kpi-chart-plot" onMouseLeave={() => { setActivePoint(null); setHoveredPeriodIndex(null); }}>
          <svg
            className="kpi-chart-svg"
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            role="group"
            aria-label={widget.title}
            onPointerMove={(event) => {
              if (widget.periods.length === 0) return;
              const bounds = event.currentTarget.getBoundingClientRect();
              if (bounds.width === 0) return;
              const svgX = ((event.clientX - bounds.left) / bounds.width) * width;
              const plotX = Math.max(left, Math.min(width - right, svgX));
              const index = widget.periods.length <= 1
                ? 0
                : Math.round(((plotX - left) / plotWidth) * (widget.periods.length - 1));
              setHoveredPeriodIndex(index);
            }}
            onPointerLeave={() => setHoveredPeriodIndex(null)}
          >
            <defs>
              <clipPath id={plotClipId}>
                <rect x={left} y={top} width={plotWidth} height={plotHeight} />
              </clipPath>
            </defs>
            {hoveredPeriodBand && <rect
              className="kpi-chart-hover-period"
              x={hoveredPeriodBand.x}
              y={top}
              width={hoveredPeriodBand.width}
              height={plotHeight}
            />}
            {[0, 1, 2, 3].map((line) => {
              const y = top + (plotHeight / 3) * line;
              return <line className="kpi-grid-line" key={line} x1={left} x2={width - right} y1={y} y2={y} />;
            })}
            {widget.periods.map((period, index) => {
              const x = xPosition(index, widget.periods.length, left, plotWidth);
              return <text className="kpi-axis-label" key={period} x={x} y={height - 8} textAnchor="middle">{formatPeriod(period, widget.series[0]?.cadence ?? 'week', locale)}</text>;
            })}
            {chartSeries.map(({ series, points: seriesPoints, linearTrend, movingAverage }) => {
              const extent = extents[series.axisSide] ?? extents.left ?? extents.right;
              if (!extent) return null;
              const yPosition = (raw: string | number | null) => {
                const value = typeof raw === 'number' ? raw : parseKpiNumber(raw);
                if (value === null) return top + plotHeight;
                return top + plotHeight - ((value - extent[0]) / (extent[1] - extent[0])) * plotHeight;
              };
              const coloredPathsFor = (values: readonly (string | number | null)[]) => splitKpiLineSegments(
                values.map((value) => ({ value: value === null ? null : String(value) })),
              ).flatMap((segment) => {
                const segmentPoints = segment.map((pointIndex) => ({
                  x: xPosition(pointIndex, widget.periods.length, left, plotWidth),
                  y: yPosition(values[pointIndex]),
                }));
                return smoothKpiLineSegmentPaths(segmentPoints).map((path, edgeIndex) => {
                  const from = parseKpiNumber(String(values[segment[edgeIndex]]));
                  const to = parseKpiNumber(String(values[segment[edgeIndex + 1]]));
                  return { path, color: series.color ?? (to !== null && from !== null && to >= from ? risingLineColor : fallingLineColor) };
                });
              });
              const trendPath = linearTrend
                ? `M${xPosition(linearTrend.startIndex, widget.periods.length, left, plotWidth).toFixed(1)},${yPosition(linearTrend.startValue).toFixed(1)} L${xPosition(linearTrend.endIndex, widget.periods.length, left, plotWidth).toFixed(1)},${yPosition(linearTrend.endValue).toFixed(1)}`
                : null;
              const trendDelta = linearTrend ? linearTrend.endValue - linearTrend.startValue : 0;
              const trendColor = trendDelta > 0 ? risingLineColor : trendDelta < 0 ? fallingLineColor : neutralTrendColor;
              const averagePaths = coloredPathsFor(movingAverage);
              const paths = coloredPathsFor(seriesPoints.map((point) => point.value));
              const pointColor = (pointIndex: number) => {
                if (series.color) return series.color;
                const current = parseKpiNumber(seriesPoints[pointIndex].value);
                if (pointIndex === 0) return risingLineColor;
                const previous = pointIndex > 0 ? parseKpiNumber(seriesPoints[pointIndex - 1].value) : null;
                if (current !== null && previous !== null) return current >= previous ? risingLineColor : fallingLineColor;
                const next = pointIndex + 1 < seriesPoints.length ? parseKpiNumber(seriesPoints[pointIndex + 1].value) : null;
                if (current !== null && next !== null) return next >= current ? risingLineColor : fallingLineColor;
                return risingLineColor;
              };
              return (
                <g key={series.seriesId}>
                  {trendPath && <path className="kpi-chart-line is-linear-trend" d={trendPath} clipPath={`url(#${plotClipId})`} style={{ stroke: trendColor }} />}
                  {averagePaths.map(({ path, color }, pathIndex) => <path className="kpi-chart-line is-moving-average" d={path} key={`average-${pathIndex}`} style={{ stroke: color }} />)}
                  {paths.map(({ path, color }, pathIndex) => <path className="kpi-chart-line" d={path} key={pathIndex} style={{ stroke: color }} />)}
                  {seriesPoints.map((point, pointIndex) => {
                    const value = parseKpiNumber(point.value);
                    if (value === null) return null;
                    const x = xPosition(pointIndex, widget.periods.length, left, plotWidth);
                    const y = yPosition(point.value);
                    const pointLabel = `${series.label} · ${formatPeriod(point.periodStart, series.cadence, locale)}: ${formatValue(point.value, series.precision)} ${series.unit}${point.isCurrentPeriod ? ` · ${currentLabel}` : ''}`;
                    return <circle
                      className={point.isCurrentPeriod ? 'kpi-chart-point is-current' : 'kpi-chart-point'}
                      cx={x}
                      cy={y}
                      r={point.isCurrentPeriod ? 5 : 3.5}
                      key={point.periodStart}
                      tabIndex={0}
                      aria-label={pointLabel}
                      onMouseEnter={() => { setActivePoint({ series, point, color: pointColor(pointIndex), x, y }); setHoveredPeriodIndex(pointIndex); }}
                      onFocus={() => { setActivePoint({ series, point, color: pointColor(pointIndex), x, y }); setHoveredPeriodIndex(pointIndex); }}
                      onBlur={() => { setActivePoint(null); setHoveredPeriodIndex(null); }}
                      style={{ stroke: pointColor(pointIndex) }}
                    ><title>{pointLabel}</title></circle>;
                  })}
                </g>
              );
            })}
          </svg>
          {activePoint && <div
            className={`kpi-chart-tooltip ${tooltipSide} ${tooltipVertical}`.trim()}
            role="tooltip"
            style={{
              left: `${(activePoint.x / width) * 100}%`,
              top: `${(activePoint.y / height) * 100}%`,
            } as CSSProperties}
          >
            <i aria-hidden="true" style={{ backgroundColor: activePoint.color }} />
            <div>
              <strong>{activePoint.series.label}</strong>
              <span>{formatPeriod(activePoint.point.periodStart, activePoint.series.cadence, locale)} · {formatValue(activePoint.point.value, activePoint.series.precision)} {activePoint.series.unit}</span>
              {activePoint.point.isCurrentPeriod && <small>{currentLabel}</small>}
              {activePoint.point.comment && <p>{activePoint.point.comment}</p>}
            </div>
          </div>}
        </div>
      )}
      <div className="kpi-chart-legend">
        {widget.series.map((series) => <span key={series.seriesId}><i style={{ backgroundColor: series.color ?? risingLineColor }} />{series.label}<small>{series.unit}</small></span>)}
        {(widget.series.some((series) => series.color === null) || widget.showLinearTrend) && <span className="kpi-chart-legend-kind"><small className="kpi-chart-trend-direction"><i className="is-linear-trend is-rising" />{trendRisingLabel}<i className="is-linear-trend is-falling" />{trendFallingLabel}</small></span>}
        {widget.showLinearTrend && <span className="kpi-chart-legend-kind"><i className="is-linear-trend" />{linearTrendLabel}</span>}
      </div>
    </div>
  );
});

function smoothKpiLineSegmentPaths(points: { x: number; y: number }[]): string[] {
  if (points.length < 2) return [];
  return points.slice(0, -1).map((current, index) => {
    const previous = points[Math.max(0, index - 1)];
    const next = points[index + 1];
    const after = points[Math.min(points.length - 1, index + 2)];
    const deltaX = next.x - current.x;
    const minimumY = Math.min(current.y, next.y);
    const maximumY = Math.max(current.y, next.y);
    const control1Y = Math.min(maximumY, Math.max(minimumY, current.y + ((next.y - previous.y) / 6)));
    const control2Y = Math.min(maximumY, Math.max(minimumY, next.y - ((after.y - current.y) / 6)));
    return `M${current.x.toFixed(1)},${current.y.toFixed(1)} C${(current.x + deltaX / 3).toFixed(1)},${control1Y.toFixed(1)} ${(next.x - deltaX / 3).toFixed(1)},${control2Y.toFixed(1)} ${next.x.toFixed(1)},${next.y.toFixed(1)}`;
  });
}

function xPosition(index: number, count: number, left: number, width: number): number {
  return count <= 1 ? left + width / 2 : left + (index / (count - 1)) * width;
}

function formatPeriod(period: string, cadence: KpiCadence, locale: string): string {
  const date = period.length === 10 ? new Date(`${period}T12:00:00Z`) : new Date(period);
  const timeZone = 'America/Chicago';
  const options: Intl.DateTimeFormatOptions = cadence === 'hour'
    ? { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone }
    : cadence === 'day' || cadence === 'week'
      ? { day: 'numeric', month: 'short', timeZone }
      : cadence === 'month'
        ? { month: 'short', year: '2-digit', timeZone }
        : { year: 'numeric', timeZone };
  return new Intl.DateTimeFormat(locale, options).format(date);
}
