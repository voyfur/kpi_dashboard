import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ApiRequestError } from '../data/api';
import { useAuth } from '../data/AuthContext';
import {
  createKpiDashboard,
  createKpiDefinition,
  createKpiDepartment,
  createKpiWidget,
  deleteKpiValue,
  deleteKpiWidget,
  listKpiDepartments,
  loadKpiDashboard,
  loadKpiDefinitions,
  updateKpiDashboard,
  updateKpiDepartment,
  updateKpiDefinition,
  updateKpiSeries,
  updateKpiWidget,
  writeKpiValue,
  type KpiCadence,
  type KpiDashboard,
  type KpiDefinition,
  type KpiDepartment,
  type KpiPoint,
  type KpiWidget,
  type KpiWidgetSeries,
} from '../data/kpiRepository';
import { canApplyServerKpiPointUpdate, getNumericExtent, parseKpiNumber, splitKpiLineSegments, validateKpiSeries, type KpiDraftStatus } from '../domain/kpi';
import { useLocale } from '../i18n/LocaleProvider';
import { getKpiSeriesValidationMessage, type Messages } from '../i18n/messages';

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

const colors = ['#1d67bd', '#d38427', '#28866d', '#8956a6'];
const cellKey = (seriesId: string, period: string) => `${seriesId}:${period}`;

export function KpiPage() {
  const { locale, messages: m } = useLocale();
  const { markUnauthenticated, user } = useAuth();
  const isAdmin = user?.isAdmin === true;
  const [departments, setDepartments] = useState<KpiDepartment[]>([]);
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [dashboardId, setDashboardId] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<KpiDashboard | null>(null);
  const [definitions, setDefinitions] = useState<KpiDefinition[]>([]);
  const [workspaceState, setWorkspaceState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [dashboardState, setDashboardState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [workspaceError, setWorkspaceError] = useState(false);
  const [dashboardError, setDashboardError] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, CellDraft>>({});
  const [newDepartmentName, setNewDepartmentName] = useState('');
  const [newDashboardName, setNewDashboardName] = useState('');
  const [dashboardSearch, setDashboardSearch] = useState('');
  const [editingDepartmentId, setEditingDepartmentId] = useState<string | null>(null);
  const [editingDepartmentName, setEditingDepartmentName] = useState('');
  const [departmentEditError, setDepartmentEditError] = useState(false);
  const [dashboardNameDraft, setDashboardNameDraft] = useState('');
  const [dashboardDescriptionDraft, setDashboardDescriptionDraft] = useState('');
  const [dashboardInfoSaving, setDashboardInfoSaving] = useState(false);
  const [dashboardInfoError, setDashboardInfoError] = useState(false);
  const [editingWidgetId, setEditingWidgetId] = useState<string | null>(null);
  const [widgetTitleDraft, setWidgetTitleDraft] = useState('');
  const [widgetDescriptionDraft, setWidgetDescriptionDraft] = useState('');
  const [widgetSeriesDraft, setWidgetSeriesDraft] = useState<string[]>([]);
  const [widgetEditSaving, setWidgetEditSaving] = useState(false);
  const [widgetEditError, setWidgetEditError] = useState(false);
  const [departmentSaving, setDepartmentSaving] = useState(false);
  const [dashboardSaving, setDashboardSaving] = useState(false);
  const [definitionSaving, setDefinitionSaving] = useState(false);
  const [definitionError, setDefinitionError] = useState(false);
  const [definitionName, setDefinitionName] = useState('');
  const [definitionDescription, setDefinitionDescription] = useState('');
  const [definitionUnit, setDefinitionUnit] = useState('');
  const [definitionPrecision, setDefinitionPrecision] = useState(0);
  const [definitionCadence, setDefinitionCadence] = useState<KpiCadence>('week');
  const [firstSeriesLabel, setFirstSeriesLabel] = useState('');
  const [secondSeriesLabel, setSecondSeriesLabel] = useState('');
  const [newChartTitle, setNewChartTitle] = useState('');
  const [chartTitle, setChartTitle] = useState('');
  const [selectedSeriesIds, setSelectedSeriesIds] = useState<string[]>([]);
  const [widgetSaving, setWidgetSaving] = useState(false);
  const [widgetError, setWidgetError] = useState(false);
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [rangeError, setRangeError] = useState(false);
  const [rangeSaving, setRangeSaving] = useState(false);
  const [catalogSavingId, setCatalogSavingId] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const [draggingWidgetId, setDraggingWidgetId] = useState<string | null>(null);
  const draftsRef = useRef<Record<string, CellDraft>>({});
  draftsRef.current = drafts;
  const dashboardRef = useRef(dashboard);
  dashboardRef.current = dashboard;
  const draftSaveTimers = useRef(new Map<string, number>());
  const savingCells = useRef(new Set<string>());
  const editsDuringSave = useRef(new Map<string, CellDraft>());
  const loadSequence = useRef(0);
  const pollInFlight = useRef(false);
  const dashboardIdRef = useRef(dashboardId);
  dashboardIdRef.current = dashboardId;
  const valueChangesChannel = useRef<BroadcastChannel | null>(null);
  const valueChangeSourceId = useRef<string | null>(null);
  if (valueChangeSourceId.current === null) valueChangeSourceId.current = window.crypto.randomUUID();

  const selectedDepartment = departments.find((item) => item.departmentId === departmentId) ?? null;
  const seriesChoices = useMemo<SeriesChoice[]>(() => definitions.flatMap((definition) =>
    definition.series.map((series) => ({
      seriesId: series.seriesId,
      label: series.label,
      definitionName: definition.name,
      cadence: definition.cadence,
      unit: definition.unit,
    }))), [definitions]);
  const selectedChoices = useMemo(
    () => selectedSeriesIds.map((id) => seriesChoices.find((item) => item.seriesId === id)).filter((item): item is SeriesChoice => Boolean(item)),
    [selectedSeriesIds, seriesChoices],
  );
  const seriesValidation = validateKpiSeries(selectedChoices);
  const widgetEditValidation = validateKpiSeries(widgetSeriesDraft.map((id) => seriesChoices.find((item) => item.seriesId === id)).filter((item): item is SeriesChoice => Boolean(item)));
  const hasUnsavedCells = Object.values(drafts).some((draft) => draft.status !== 'saved');

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
      setDepartments(next);
      setDepartmentId((current) => current && next.some((item) => item.departmentId === current)
        ? current
        : next[0]?.departmentId ?? null);
      setWorkspaceError(false);
      setWorkspaceState('ready');
      return next;
    } catch (error) {
      handleRequestError(error);
      setWorkspaceError(true);
      setWorkspaceState('error');
      return null;
    }
  }, [handleRequestError]);

  const refreshDashboard = useCallback(async (id: string, options: { quiet?: boolean } = {}) => {
    const sequence = ++loadSequence.current;
    if (!options.quiet) setDashboardState('loading');
    try {
      const next = await loadKpiDashboard(id);
      if (loadSequence.current !== sequence) return null;
      syncSavedDrafts(next);
      setDashboard(next);
      if (!options.quiet) {
        setDashboardNameDraft(next.name);
        setDashboardDescriptionDraft(next.description ?? '');
        setRangeStart(next.rangeStart ?? '');
        setRangeEnd(next.rangeEnd ?? '');
        setDashboardState('ready');
      }
      setDashboardError(false);
      return next;
    } catch (error) {
      if (loadSequence.current !== sequence) return null;
      handleRequestError(error);
      if (!options.quiet) {
        setDashboardError(true);
        setDashboardState('error');
      }
      return null;
    }
  }, [handleRequestError, syncSavedDrafts]);

  useEffect(() => {
    void refreshWorkspace();
  }, [refreshWorkspace]);

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
    if (!selectedDepartment) {
      setDefinitions([]);
      setDashboardId(null);
      setDashboard(null);
      setDashboardState('idle');
      return;
    }
    setDashboardId((current) => selectedDepartment.dashboards.some((item) => item.dashboardId === current)
      ? current
      : selectedDepartment.dashboards[0]?.dashboardId ?? null);
    loadKpiDefinitions(selectedDepartment.departmentId)
      .then(setDefinitions)
      .catch((error: unknown) => {
        handleRequestError(error);
        setDefinitions([]);
      });
  }, [handleRequestError, selectedDepartment]);

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
    setDepartmentSaving(true);
    try {
      const created = await createKpiDepartment(newDepartmentName.trim());
      setNewDepartmentName('');
      const latest = await refreshWorkspace();
      setDepartmentId(created.departmentId);
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

  async function submitDashboard(event: FormEvent) {
    event.preventDefault();
    if (!departmentId || !newDashboardName.trim() || dashboardSaving) return;
    setDashboardSaving(true);
    try {
      const created = await createKpiDashboard(departmentId, newDashboardName.trim());
      setNewDashboardName('');
      setDepartments((current) => current.map((department) => department.departmentId !== departmentId
        ? department
        : { ...department, dashboards: [...department.dashboards, created] }));
      setDashboardId(created.dashboardId);
    } catch (error) {
      handleRequestError(error);
      setWorkspaceError(true);
    } finally {
      setDashboardSaving(false);
    }
  }

  async function submitDepartmentEdit(event: FormEvent, department: KpiDepartment) {
    event.preventDefault();
    if (!editingDepartmentName.trim() || departmentSaving) return;
    setDepartmentSaving(true);
    setDepartmentEditError(false);
    try {
      const updated = await updateKpiDepartment(department.departmentId, { name: editingDepartmentName.trim() });
      setDepartments((current) => current.map((item) => item.departmentId === department.departmentId ? { ...item, name: updated.name } : item));
      setEditingDepartmentId(null);
    } catch (error) {
      handleRequestError(error);
      setDepartmentEditError(true);
    } finally {
      setDepartmentSaving(false);
    }
  }

  async function reorderDepartment(department: KpiDepartment, offset: -1 | 1) {
    const ordered = [...departments].sort((left, right) => left.sortOrder - right.sortOrder);
    const from = ordered.findIndex((item) => item.departmentId === department.departmentId);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= ordered.length) return;
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);
    try {
      await Promise.all(ordered.map((item, index) => updateKpiDepartment(item.departmentId, { sortOrder: index })));
      setDepartments(ordered.map((item, index) => ({ ...item, sortOrder: index })));
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

  async function saveDefinitionDetails(event: FormEvent, definition: KpiDefinition) {
    event.preventDefault();
    if (catalogSavingId) return;
    const form = new FormData(event.currentTarget as HTMLFormElement);
    setCatalogSavingId(definition.definitionId);
    setCatalogError(false);
    try {
      const updated = await updateKpiDefinition(definition.definitionId, {
        name: String(form.get('name') ?? '').trim(),
        description: String(form.get('description') ?? '').trim() || null,
        unit: String(form.get('unit') ?? '').trim(),
        precision: Number(form.get('precision')),
        cadence: String(form.get('cadence')) as KpiCadence,
      });
      setDefinitions((current) => current.map((item) => item.definitionId === updated.definitionId ? updated : item));
      if (dashboardId) await refreshDashboard(dashboardId);
    } catch (error) {
      handleRequestError(error);
      setCatalogError(true);
    } finally {
      setCatalogSavingId(null);
    }
  }

  async function saveSeriesLabel(event: FormEvent, seriesId: string) {
    event.preventDefault();
    if (catalogSavingId) return;
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const label = String(form.get('label') ?? '').trim();
    if (!label) return;
    setCatalogSavingId(seriesId);
    setCatalogError(false);
    try {
      const updated = await updateKpiSeries(seriesId, label);
      setDefinitions((current) => current.map((item) => ({
        ...item,
        series: item.series.map((series) => series.seriesId === seriesId ? { ...series, label: updated.label } : series),
      })));
      if (dashboardId) await refreshDashboard(dashboardId);
    } catch (error) {
      handleRequestError(error);
      setCatalogError(true);
    } finally {
      setCatalogSavingId(null);
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
      if (dashboardId) await refreshDashboard(dashboardId);
    } catch (error) {
      handleRequestError(error);
      setWidgetEditError(true);
    } finally {
      setWidgetEditSaving(false);
    }
  }

  async function submitDefinition(event: FormEvent) {
    event.preventDefault();
    if (!departmentId || !dashboardId || !definitionName.trim() || !definitionUnit.trim()
      || !firstSeriesLabel.trim() || !secondSeriesLabel.trim() || !newChartTitle.trim() || definitionSaving) return;
    setDefinitionSaving(true);
    setDefinitionError(false);
    try {
      const definition = await createKpiDefinition(departmentId, {
        name: definitionName.trim(),
        unit: definitionUnit.trim(),
        precision: definitionPrecision,
        cadence: definitionCadence,
        description: definitionDescription.trim() || null,
        seriesLabels: [firstSeriesLabel.trim(), secondSeriesLabel.trim()],
      });
      await createKpiWidget(dashboardId, {
        title: newChartTitle.trim(),
        seriesIds: definition.series.map((item) => item.seriesId),
      });
      setDefinitions((current) => [...current, definition]);
      setSelectedSeriesIds(definition.series.map((item) => item.seriesId));
      setChartTitle('');
      setDefinitionName('');
      setDefinitionDescription('');
      setDefinitionUnit('');
      setFirstSeriesLabel('');
      setSecondSeriesLabel('');
      setNewChartTitle('');
      await refreshDashboard(dashboardId);
    } catch (error) {
      handleRequestError(error);
      setDefinitionError(true);
      if (departmentId) {
        loadKpiDefinitions(departmentId).then(setDefinitions).catch(() => undefined);
      }
    } finally {
      setDefinitionSaving(false);
    }
  }

  async function submitWidget(event: FormEvent) {
    event.preventDefault();
    if (!dashboardId || !chartTitle.trim() || seriesValidation !== null || widgetSaving) return;
    setWidgetSaving(true);
    setWidgetError(false);
    try {
      await createKpiWidget(dashboardId, { title: chartTitle.trim(), seriesIds: selectedSeriesIds });
      setChartTitle('');
      await refreshDashboard(dashboardId);
    } catch (error) {
      handleRequestError(error);
      setWidgetError(true);
    } finally {
      setWidgetSaving(false);
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

  async function changeDashboard(nextId: string) {
    if (nextId === dashboardId) return;
    if (hasUnsavedCells && !window.confirm(m.kpiUnsavedLeave)) return;
    draftsRef.current = {};
    setDrafts({});
    setDashboardId(nextId);
  }

  function changeDepartment(nextId: string) {
    if (nextId === departmentId) return;
    if (hasUnsavedCells && !window.confirm(m.kpiUnsavedLeave)) return;
    draftsRef.current = {};
    setDrafts({});
    setDepartmentId(nextId);
  }

  async function updateLayout(widget: KpiWidget, patch: Partial<Pick<KpiWidget, 'sortOrder' | 'gridWidth' | 'gridHeight' | 'periodCount'>>) {
    try {
      await updateKpiWidget(widget.widgetId, patch);
      if (dashboardId) await refreshDashboard(dashboardId);
    } catch (error) {
      handleRequestError(error);
      setDashboardError(true);
    }
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

  async function reorderWidget(draggedId: string, targetId: string) {
    if (!dashboard || draggedId === targetId) return;
    const next = [...dashboard.widgets];
    const from = next.findIndex((item) => item.widgetId === draggedId);
    const to = next.findIndex((item) => item.widgetId === targetId);
    if (from < 0 || to < 0) return;
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    try {
      await Promise.all(next.map((widget, index) => updateKpiWidget(widget.widgetId, { sortOrder: index })));
      setDashboard((current) => current ? { ...current, widgets: next.map((widget, index) => ({ ...widget, sortOrder: index })) } : current);
    } catch (error) {
      handleRequestError(error);
      if (dashboardId) await refreshDashboard(dashboardId);
    }
  }

  function toggleSeries(seriesId: string) {
    setSelectedSeriesIds((current) => current.includes(seriesId)
      ? current.filter((id) => id !== seriesId)
      : current.length >= 4 ? current : [...current, seriesId]);
  }

  return (
    <section className="kpi-page" aria-labelledby="kpi-page-title">
      <header className="kpi-page-heading">
        <div>
          <span className="section-kicker">{m.navKpi}</span>
          <h1 id="kpi-page-title">{m.kpiPageTitle}</h1>
          <p>{m.kpiPageIntro}</p>
        </div>
        {selectedDepartment && <span className="kpi-workspace-tag">{selectedDepartment.name}</span>}
      </header>

      <div className="kpi-workspace">
        <aside className="kpi-rail" aria-label={m.kpiDepartments}>
          <div className="kpi-rail-heading">
            <span className="section-kicker">{m.kpiDepartments}</span>
            <span className="kpi-count">{departments.length}</span>
          </div>
          {workspaceState === 'loading' ? <p className="kpi-muted">{m.kpiLoading}</p> : null}
          {workspaceState === 'error' && workspaceError ? (
            <div className="kpi-error-inline" role="alert">
              <span>{m.kpiLoadError}</span>
              <button className="kpi-text-button" type="button" onClick={() => void refreshWorkspace()}>{m.retry}</button>
            </div>
          ) : null}
          {departments.length === 0 && workspaceState === 'ready' && <p className="kpi-muted">{m.kpiNoDepartments}</p>}
          <div className="kpi-department-list">
            {[...departments].sort((left, right) => left.sortOrder - right.sortOrder).map((department, index) => (
              <div className="kpi-department-row" key={department.departmentId}>
                <button
                  type="button"
                  className={department.departmentId === departmentId ? 'kpi-department is-active' : 'kpi-department'}
                  aria-pressed={department.departmentId === departmentId}
                  onClick={() => changeDepartment(department.departmentId)}
                >
                  <span className="kpi-department-mark" aria-hidden="true">{department.name.trim().slice(0, 1).toLocaleUpperCase()}</span>
                  <span className="kpi-department-name">{department.name}</span>
                  <span className="kpi-count">{department.dashboards.length}</span>
                </button>
                {isAdmin && <div className="kpi-admin-inline-actions">
                  <button className="kpi-icon-button" type="button" aria-label={m.kpiMoveUp} disabled={index === 0} onClick={() => void reorderDepartment(department, -1)}>↑</button>
                  <button className="kpi-icon-button" type="button" aria-label={m.kpiMoveDown} disabled={index === departments.length - 1} onClick={() => void reorderDepartment(department, 1)}>↓</button>
                  <button className="kpi-icon-button" type="button" aria-label={m.kpiRenameDepartment} onClick={() => { setEditingDepartmentId(department.departmentId); setEditingDepartmentName(department.name); setDepartmentEditError(false); }}>✎</button>
                </div>}
                {isAdmin && editingDepartmentId === department.departmentId && <form className="kpi-rail-form" onSubmit={(event) => void submitDepartmentEdit(event, department)}>
                  <label>{m.kpiRenameDepartment}<input autoFocus value={editingDepartmentName} maxLength={120} onChange={(event) => setEditingDepartmentName(event.target.value)} /></label>
                  {departmentEditError && <span className="kpi-field-error" role="alert">{m.kpiEditError}</span>}
                  <div className="kpi-form-row">
                    <button className="button" type="submit" disabled={departmentSaving || !editingDepartmentName.trim()}>{m.kpiSaveChanges}</button>
                    <button className="kpi-text-button" type="button" onClick={() => setEditingDepartmentId(null)}>{m.kpiCancelEdit}</button>
                  </div>
                </form>}
              </div>
            ))}
          </div>
          {isAdmin && <form className="kpi-rail-form" onSubmit={(event) => void submitDepartment(event)}>
            <label htmlFor="kpi-new-department">{m.kpiDepartmentName}</label>
            <div className="kpi-form-row">
              <input id="kpi-new-department" value={newDepartmentName} maxLength={120} onChange={(event) => setNewDepartmentName(event.target.value)} />
              <button className="kpi-icon-button" type="submit" aria-label={m.kpiCreateDepartment} disabled={departmentSaving || !newDepartmentName.trim()}>+</button>
            </div>
            {departmentSaving && <span className="kpi-muted">{m.kpiCreating}</span>}
          </form>}

          {selectedDepartment && (
            <div className="kpi-dashboard-nav">
              <div className="kpi-rail-heading">
                <span className="section-kicker">{selectedDepartment.name}</span>
              </div>
              {selectedDepartment.dashboards.length > 3 && <label className="kpi-search-field">
                <span>{m.kpiSearchDashboard}</span>
                <input type="search" value={dashboardSearch} onChange={(event) => setDashboardSearch(event.target.value)} placeholder={m.kpiSearchDashboard} />
              </label>}
              {selectedDepartment.dashboards.filter((item) => item.name.toLocaleLowerCase().includes(dashboardSearch.trim().toLocaleLowerCase())).map((item) => (
                <button
                  className={dashboardId === item.dashboardId ? 'kpi-dashboard-link is-active' : 'kpi-dashboard-link'}
                  type="button"
                  key={item.dashboardId}
                  onClick={() => void changeDashboard(item.dashboardId)}
                >
                  <span className="kpi-dashboard-dot" aria-hidden="true" />
                  {item.name}
                </button>
              ))}
              {selectedDepartment.dashboards.length > 0 && !selectedDepartment.dashboards.some((item) => item.name.toLocaleLowerCase().includes(dashboardSearch.trim().toLocaleLowerCase())) && <p className="kpi-muted">{m.kpiNoDashboardResults}</p>}
              {isAdmin && <form className="kpi-rail-form kpi-dashboard-create" onSubmit={(event) => void submitDashboard(event)}>
                <label htmlFor="kpi-new-dashboard">{m.kpiDashboardName}</label>
                <div className="kpi-form-row">
                  <input id="kpi-new-dashboard" value={newDashboardName} maxLength={160} onChange={(event) => setNewDashboardName(event.target.value)} />
                  <button className="kpi-icon-button" type="submit" aria-label={m.kpiCreateDashboard} disabled={dashboardSaving || !newDashboardName.trim()}>+</button>
                </div>
              </form>}
            </div>
          )}
        </aside>

        <div className="kpi-content">
          {!selectedDepartment ? null : !dashboardId ? (
            <div className="kpi-empty-workspace">
              <span className="kpi-empty-mark" aria-hidden="true">↗</span>
              <h2>{m.kpiChooseDashboard}</h2>
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
                  <label>
                    <span>{m.kpiStartDate}</span>
                    <input type="date" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} />
                  </label>
                  <label>
                    <span>{m.kpiEndDate}</span>
                    <input type="date" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} />
                  </label>
                  <button className="button button-secondary" type="button" disabled={rangeSaving} onClick={() => void applyRange()}>{rangeSaving ? m.kpiSaving : m.kpiApplyRange}</button>
                  {(dashboard.rangeStart || dashboard.rangeEnd) && <button className="kpi-text-button" type="button" onClick={() => { setRangeStart(''); setRangeEnd(''); void applyRange(true); }}>{m.kpiRecentPeriods}</button>}
                  {rangeError && <span className="kpi-field-error" role="alert">{m.kpiInvalidRange}</span>}
                </div>}
              </div>

              {isAdmin && <div className="kpi-create-grid">
                <details className="kpi-create-panel" open={dashboard.widgets.length === 0}>
                  <summary>{m.kpiAddKpi}</summary>
                  <form className="kpi-create-form" onSubmit={(event) => void submitDefinition(event)}>
                    <label>{m.kpiDefinitionName}<input value={definitionName} required maxLength={160} onChange={(event) => setDefinitionName(event.target.value)} /></label>
                    <label>{m.kpiDescription}<textarea rows={2} value={definitionDescription} onChange={(event) => setDefinitionDescription(event.target.value)} /></label>
                    <div className="kpi-form-pair">
                      <label>{m.kpiUnit}<input value={definitionUnit} required maxLength={64} placeholder="USD, %, count" onChange={(event) => setDefinitionUnit(event.target.value)} /></label>
                      <label>{m.kpiPrecision}<input type="number" min={0} max={8} value={definitionPrecision} onChange={(event) => setDefinitionPrecision(Number(event.target.value))} /></label>
                    </div>
                    <label>{m.kpiCadence}
                      <select value={definitionCadence} onChange={(event) => setDefinitionCadence(event.target.value as KpiCadence)}>
                        <option value="week">{m.kpiWeek}</option><option value="month">{m.kpiMonth}</option><option value="year">{m.kpiYear}</option>
                      </select>
                    </label>
                    <div className="kpi-form-pair">
                      <label>{m.kpiSeriesOne}<input value={firstSeriesLabel} required maxLength={120} onChange={(event) => setFirstSeriesLabel(event.target.value)} /></label>
                      <label>{m.kpiSeriesTwo}<input value={secondSeriesLabel} required maxLength={120} onChange={(event) => setSecondSeriesLabel(event.target.value)} /></label>
                    </div>
                    <label>{m.kpiWidgetTitle}<input value={newChartTitle} required maxLength={160} onChange={(event) => setNewChartTitle(event.target.value)} /></label>
                    {definitionError && <span className="kpi-field-error" role="alert">{m.kpiCreateError}</span>}
                    <button className="button" type="submit" disabled={definitionSaving}>{definitionSaving ? m.kpiCreating : m.kpiAddChart}</button>
                  </form>
                </details>

                {seriesChoices.length >= 2 && (
                  <details className="kpi-create-panel">
                    <summary>{m.kpiAddChart}</summary>
                    <form className="kpi-create-form" onSubmit={(event) => void submitWidget(event)}>
                      <label>{m.kpiWidgetTitle}<input value={chartTitle} required maxLength={160} onChange={(event) => setChartTitle(event.target.value)} /></label>
                      <div className="kpi-series-picker" aria-label={m.kpiSelectTwoSeries}>
                        {seriesChoices.map((choice) => (
                          <label className="kpi-series-option" key={choice.seriesId}>
                            <input type="checkbox" checked={selectedSeriesIds.includes(choice.seriesId)} disabled={!selectedSeriesIds.includes(choice.seriesId) && selectedSeriesIds.length >= 4} onChange={() => toggleSeries(choice.seriesId)} />
                            <span><strong>{choice.label}</strong><small>{choice.definitionName} · {choice.unit} · {choice.cadence}</small></span>
                          </label>
                        ))}
                      </div>
                      {seriesValidation !== null && <span className="kpi-field-error">{getKpiSeriesValidationMessage(m, seriesValidation)}</span>}
                      {widgetError && <span className="kpi-field-error" role="alert">{m.kpiCreateError}</span>}
                      <button className="button" type="submit" disabled={widgetSaving || seriesValidation !== null}>{widgetSaving ? m.kpiCreating : m.kpiAddChart}</button>
                    </form>
                  </details>
                )}
                <details className="kpi-create-panel kpi-catalog-panel">
                  <summary>{m.kpiDefinitionCatalog}</summary>
                  {definitions.length === 0 ? <p className="kpi-muted">{m.kpiDashboardEmpty}</p> : definitions.map((definition) => (
                    <div className="kpi-catalog-item" key={definition.definitionId}>
                      <form className="kpi-create-form" onSubmit={(event) => void saveDefinitionDetails(event, definition)}>
                        <label>{m.kpiDefinitionName}<input name="name" defaultValue={definition.name} maxLength={160} required /></label>
                        <label>{m.kpiDescription}<textarea name="description" rows={2} defaultValue={definition.description ?? ''} /></label>
                        <div className="kpi-form-pair">
                          <label>{m.kpiUnit}<input name="unit" defaultValue={definition.unit} maxLength={64} required /></label>
                          <label>{m.kpiPrecision}<input name="precision" type="number" min={0} max={8} defaultValue={definition.precision} /></label>
                        </div>
                        <label>{m.kpiCadence}<select name="cadence" defaultValue={definition.cadence}>
                          <option value="week">{m.kpiWeek}</option><option value="month">{m.kpiMonth}</option><option value="year">{m.kpiYear}</option>
                        </select></label>
                        <button className="button" type="submit" disabled={catalogSavingId !== null}>{catalogSavingId === definition.definitionId ? m.kpiSaving : m.kpiSaveChanges}</button>
                      </form>
                      <div className="kpi-catalog-series">
                        {definition.series.map((series) => <form className="kpi-form-row" key={series.seriesId} onSubmit={(event) => void saveSeriesLabel(event, series.seriesId)}>
                          <input aria-label={series.label} name="label" defaultValue={series.label} maxLength={120} required />
                          <button className="kpi-icon-button" type="submit" aria-label={m.kpiSaveChanges} disabled={catalogSavingId !== null}>↵</button>
                        </form>)}
                      </div>
                    </div>
                  ))}
                  {catalogError && <span className="kpi-field-error" role="alert">{m.kpiEditError}</span>}
                </details>
              </div>}

              {dashboard.widgets.length === 0 ? (
                <div className="kpi-empty-chart-state"><p>{m.kpiDashboardEmpty}</p></div>
              ) : (
                <div className="kpi-widget-grid">
                  {[...dashboard.widgets].sort((left, right) => left.sortOrder - right.sortOrder).map((widget, index) => (
                    <article
                      className="kpi-widget"
                      style={{ gridColumn: widget.gridWidth >= 12 ? '1 / -1' : 'span 6', minHeight: `${Math.max(250, widget.gridHeight * 66)}px` }}
                      key={widget.widgetId}
                      draggable={isAdmin}
                      onDragStart={() => setDraggingWidgetId(widget.widgetId)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => { if (draggingWidgetId) void reorderWidget(draggingWidgetId, widget.widgetId); setDraggingWidgetId(null); }}
                      onDragEnd={() => setDraggingWidgetId(null)}
                    >
                      <div className="kpi-widget-heading">
                        <div className="kpi-widget-title-group">
                          <span className="kpi-drag-grip" aria-hidden="true">⠿</span>
                          <div><h3>{widget.title}</h3>{widget.description && <p>{widget.description}</p>}</div>
                        </div>
                        {isAdmin && <div className="kpi-widget-actions">
                          <button className="kpi-icon-button" type="button" aria-label={m.kpiEditChart} title={m.kpiEditChart} onClick={() => beginWidgetEdit(widget)}>✎</button>
                          <label className="kpi-compact-control"><span>{m.kpiWidgetWidth}</span><select value={widget.gridWidth >= 12 ? 12 : 6} onChange={(event) => void updateLayout(widget, { gridWidth: Number(event.target.value) })}>
                            <option value={6}>{m.kpiHalfWidth}</option><option value={12}>{m.kpiFullWidth}</option>
                          </select></label>
                          <label className="kpi-compact-control"><span>{m.kpiWidgetHeight}</span><select value={widget.gridHeight} onChange={(event) => void updateLayout(widget, { gridHeight: Number(event.target.value) })}>
                            {[2, 3, 4, 5, 6, 7, 8].map((height) => <option value={height} key={height}>{height}</option>)}
                          </select></label>
                          <label className="kpi-compact-control"><span>{m.kpiPeriods}</span><select value={widget.periodCount} onChange={(event) => void updateLayout(widget, { periodCount: Number(event.target.value) })}>
                            {[4, 8, 12, 16, 24, 36, 52, 60].map((count) => <option value={count} key={count}>{count}</option>)}
                          </select></label>
                          <button className="kpi-icon-button" type="button" aria-label={m.kpiMoveUp} title={m.kpiMoveUp} disabled={index === 0} onClick={() => void updateLayout(widget, { sortOrder: index - 1 })}>↑</button>
                          <button className="kpi-icon-button" type="button" aria-label={m.kpiMoveDown} title={m.kpiMoveDown} disabled={index === dashboard.widgets.length - 1} onClick={() => void updateLayout(widget, { sortOrder: index + 1 })}>↓</button>
                          <button className="kpi-icon-button is-danger" type="button" aria-label={m.kpiDeleteWidget} title={m.kpiDeleteWidget} onClick={() => void removeWidget(widget)}>×</button>
                        </div>}
                      </div>
                      {isAdmin && editingWidgetId === widget.widgetId && <form className="kpi-widget-edit-form" onSubmit={(event) => void submitWidgetEdit(event, widget)}>
                        <label>{m.kpiWidgetTitle}<input value={widgetTitleDraft} maxLength={160} onChange={(event) => setWidgetTitleDraft(event.target.value)} /></label>
                        <label>{m.kpiDescription}<textarea rows={2} value={widgetDescriptionDraft} onChange={(event) => setWidgetDescriptionDraft(event.target.value)} /></label>
                        <div className="kpi-series-picker" aria-label={m.kpiSelectTwoSeries}>
                          {seriesChoices.map((choice) => <label className="kpi-series-option" key={choice.seriesId}>
                            <input type="checkbox" checked={widgetSeriesDraft.includes(choice.seriesId)} disabled={!widgetSeriesDraft.includes(choice.seriesId) && widgetSeriesDraft.length >= 4} onChange={() => setWidgetSeriesDraft((current) => current.includes(choice.seriesId) ? current.filter((id) => id !== choice.seriesId) : current.length >= 4 ? current : [...current, choice.seriesId])} />
                            <span><strong>{choice.label}</strong><small>{choice.definitionName} · {choice.unit} · {choice.cadence}</small></span>
                          </label>)}
                        </div>
                        {widgetEditValidation !== null && <span className="kpi-field-error">{getKpiSeriesValidationMessage(m, widgetEditValidation)}</span>}
                        {widgetEditError && <span className="kpi-field-error" role="alert">{m.kpiEditError}</span>}
                        <div className="kpi-form-row"><button className="button" type="submit" disabled={widgetEditSaving || widgetEditValidation !== null}>{widgetEditSaving ? m.kpiSaving : m.kpiSaveChanges}</button><button className="kpi-text-button" type="button" onClick={() => setEditingWidgetId(null)}>{m.kpiCancelEdit}</button></div>
                      </form>}
                      <KpiChart widget={widget} locale={locale} emptyLabel={m.kpiNoValues} currentLabel={m.kpiCurrentPeriod} leftLabel={m.kpiAxisLeft} rightLabel={m.kpiAxisRight} />
                      <KpiValueTable
                        widget={widget}
                        locale={locale}
                        messages={m}
                        drafts={drafts}
                        onEditCell={editCell}
                        onSaveCell={saveCell}
                        onRetryCell={retryCell}
                      />
                    </article>
                  ))}
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
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

const KpiChart = memo(function KpiChart({
  widget,
  locale,
  emptyLabel,
  currentLabel,
  leftLabel,
  rightLabel,
}: {
  widget: KpiWidget;
  locale: string;
  emptyLabel: string;
  currentLabel: string;
  leftLabel: string;
  rightLabel: string;
}) {
  const width = 720;
  const height = 232;
  const left = 48;
  const right = 48;
  const top = 18;
  const bottom = 34;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const allValues = widget.series.flatMap((series) => series.points.map((point) => point.value));
  const hasValues = getNumericExtent(allValues) !== null;
  const extents = {
    left: getNumericExtent(widget.series.filter((series) => series.axisSide === 'left').flatMap((series) => series.points.map((point) => point.value))),
    right: getNumericExtent(widget.series.filter((series) => series.axisSide === 'right').flatMap((series) => series.points.map((point) => point.value))),
  };
  const formatValue = (value: string | null, precision: number) => {
    const number = parseKpiNumber(value);
    if (number === null) return '—';
    return new Intl.NumberFormat(locale, { maximumFractionDigits: precision }).format(number);
  };

  return (
    <div className="kpi-chart-block">
      <div className="kpi-chart-axes">
        {[...new Set(widget.series.map((series) => `${series.axisSide}:${series.unit}`))].map((item) => {
          const [side, unit] = item.split(':');
          return <span className={`kpi-axis-tag is-${side}`} key={item}><b>{side === 'right' ? rightLabel : leftLabel}</b> {unit}</span>;
        })}
      </div>
      {!hasValues ? <div className="kpi-chart-empty">{emptyLabel}</div> : (
        <svg className="kpi-chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={widget.title}>
          {[0, 1, 2, 3].map((line) => {
            const y = top + (plotHeight / 3) * line;
            return <line className="kpi-grid-line" key={line} x1={left} x2={width - right} y1={y} y2={y} />;
          })}
          {widget.periods.map((period, index) => {
            const x = xPosition(index, widget.periods.length, left, plotWidth);
            return <text className="kpi-axis-label" key={period} x={x} y={height - 8} textAnchor="middle">{formatPeriod(period, widget.series[0]?.cadence ?? 'week', locale)}</text>;
          })}
          {widget.series.map((series, seriesIndex) => {
            const extent = extents[series.axisSide] ?? extents.left ?? extents.right;
            if (!extent) return null;
            const seriesPoints = widget.periods.map((period) => series.points.find((point) => point.periodStart === period) ?? { periodStart: period, value: null, comment: null, updatedAt: null, isCurrentPeriod: false });
            const yPosition = (raw: string | null) => {
              const value = parseKpiNumber(raw);
              if (value === null) return top + plotHeight;
              return top + plotHeight - ((value - extent[0]) / (extent[1] - extent[0])) * plotHeight;
            };
            const paths = splitKpiLineSegments(seriesPoints).map((segment) => segment.map((pointIndex, step) => {
              const x = xPosition(pointIndex, widget.periods.length, left, plotWidth);
              const y = yPosition(seriesPoints[pointIndex].value);
              return `${step === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
            }).join(' '));
            return (
              <g key={series.seriesId}>
                {paths.map((path, pathIndex) => <path className="kpi-chart-line" d={path} key={pathIndex} style={{ stroke: colors[seriesIndex % colors.length] }} />)}
                {seriesPoints.map((point, pointIndex) => {
                  const value = parseKpiNumber(point.value);
                  if (value === null) return null;
                  const x = xPosition(pointIndex, widget.periods.length, left, plotWidth);
                  const y = yPosition(point.value);
                  return <circle className={point.isCurrentPeriod ? 'kpi-chart-point is-current' : 'kpi-chart-point'} cx={x} cy={y} r={point.isCurrentPeriod ? 5 : 3.5} key={point.periodStart} style={{ stroke: colors[seriesIndex % colors.length] }}><title>{`${series.label} · ${point.periodStart}: ${formatValue(point.value, series.precision)} ${series.unit}${point.isCurrentPeriod ? ` · ${currentLabel}` : ''}`}</title></circle>;
                })}
              </g>
            );
          })}
        </svg>
      )}
      <div className="kpi-chart-legend">
        {widget.series.map((series, index) => <span key={series.seriesId}><i style={{ backgroundColor: colors[index % colors.length] }} />{series.label}<small>{series.unit}</small></span>)}
      </div>
    </div>
  );
});

function xPosition(index: number, count: number, left: number, width: number): number {
  return count <= 1 ? left + width / 2 : left + (index / (count - 1)) * width;
}

function formatPeriod(period: string, cadence: KpiCadence, locale: string): string {
  const date = new Date(`${period}T12:00:00Z`);
  const options: Intl.DateTimeFormatOptions = cadence === 'week'
    ? { day: 'numeric', month: 'short', timeZone: 'Europe/Kyiv' }
    : cadence === 'month'
      ? { month: 'short', year: '2-digit', timeZone: 'Europe/Kyiv' }
      : { year: 'numeric', timeZone: 'Europe/Kyiv' };
  return new Intl.DateTimeFormat(locale, options).format(date);
}
