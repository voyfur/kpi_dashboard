import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  createKpiDefinition,
  createKpiWidget,
  loadKpiSeriesPreview,
  updateKpiWidget,
  type KpiCadence,
  type KpiDefinition,
  type KpiWidget,
  type KpiWidgetSeries,
} from '../data/kpiRepository';
import { getNumericExtent, parseKpiNumber, splitKpiLineSegments, validateKpiSeries } from '../domain/kpi';
import {
  findKpiCreatePosition,
  findNearestKpiGridPosition,
  getKpiAddTilePosition,
  getKpiGridRowSpan,
  KPI_GRID_ROW_GAP_PX,
  KPI_GRID_ROW_STEP_PX,
  type KpiGridItem,
  type KpiGridRectangle,
} from '../domain/kpiLayout';
import type { Locale } from '../domain/types';
import { getKpiSeriesValidationMessage, type Messages } from '../i18n/messages';

export type KpiAddWidgetDialogContext = {
  departmentId: string;
  departmentPath: string;
  dashboardId: string;
  dashboardName: string;
};

type SeriesChoice = {
  seriesId: string;
  label: string;
  definitionName: string;
  cadence: KpiCadence;
  unit: string;
  precision: number;
};

type Props = {
  context: KpiAddWidgetDialogContext;
  definitions: KpiDefinition[];
  editingWidget?: KpiWidget;
  layoutWidgets: readonly KpiGridItem[];
  gridContainerWidth: number;
  layoutReady: boolean;
  locale: Locale;
  messages: Messages;
  onDefinitionCreated: (definition: KpiDefinition) => void;
  onCompleted: (dashboardId: string) => Promise<void>;
  onDismiss: (createdDefinitionId: string | null) => void;
  onRequestError: (error: unknown) => void;
};

const periodCounts = [4, 8, 12, 16, 24, 36, 52, 60];
const seriesColors = ['#1d67bd', '#d38427', '#28866d', '#8956a6', '#b54b62', '#5b6d26', '#386f8c', '#bc6b29', '#6d5b9b', '#4e8171'];

export function KpiAddWidgetDialog({
  context,
  definitions,
  editingWidget,
  layoutWidgets,
  gridContainerWidth,
  layoutReady,
  locale,
  messages: m,
  onDefinitionCreated,
  onCompleted,
  onDismiss,
  onRequestError,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previewRequest = useRef(0);
  const createdDefinition = useRef<KpiDefinition | null>(null);
  const completed = useRef(false);
  const [sourceMode, setSourceMode] = useState<'new' | 'existing'>(editingWidget ? 'existing' : 'new');
  const [definitionName, setDefinitionName] = useState('');
  const [definitionDescription, setDefinitionDescription] = useState('');
  const [unit, setUnit] = useState('');
  const [precision, setPrecision] = useState(0);
  const [cadence, setCadence] = useState<KpiCadence>('week');
  const [newSeriesCount, setNewSeriesCount] = useState(0);
  const [newSeriesLabels, setNewSeriesLabels] = useState<string[]>([]);
  const [widgetTitle, setWidgetTitle] = useState(editingWidget?.title ?? '');
  const [selectedSeriesIds, setSelectedSeriesIds] = useState<string[]>(() => editingWidget?.series.map((series) => series.seriesId) ?? []);
  const [gridWidth, setGridWidth] = useState(editingWidget?.gridWidth ?? 6);
  const [gridHeight, setGridHeight] = useState(editingWidget?.gridHeight ?? 4);
  const [periodCount, setPeriodCount] = useState(editingWidget?.periodCount ?? 8);
  const [previewSeries, setPreviewSeries] = useState<KpiWidgetSeries[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [failedStep, setFailedStep] = useState<'definition' | 'widget' | null>(null);
  const [createdDefinitionName, setCreatedDefinitionName] = useState('');
  const [saving, setSaving] = useState(false);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);

  const seriesChoices = useMemo<SeriesChoice[]>(() => {
    const allChoices = definitions.flatMap((definition) =>
      definition.series.map((series) => ({
        seriesId: series.seriesId,
        label: series.label,
        definitionName: definition.name,
        cadence: definition.cadence,
        unit: definition.unit,
        precision: definition.precision,
      })));
    if (!editingWidget) return allChoices;

    const choiceById = new Map(allChoices.map((choice) => [choice.seriesId, choice]));
    return editingWidget.series
      .map((series) => choiceById.get(series.seriesId))
      .filter((choice): choice is SeriesChoice => choice !== undefined);
  }, [definitions, editingWidget]);
  const selectedChoices = selectedSeriesIds
    .map((id) => seriesChoices.find((choice) => choice.seriesId === id))
    .filter((choice): choice is SeriesChoice => Boolean(choice));
  const hasSeriesChoices = seriesChoices.length > 0;
  const seriesValidation = validateKpiSeries(selectedChoices);
  const selectedSeriesKey = selectedSeriesIds.join('\u0000');
  const normalizedSeriesLabels = newSeriesLabels.map((label) => label.trim().toLocaleLowerCase(locale));
  const duplicateSeriesIndexes = new Set<number>();
  const firstIndexByLabel = new Map<string, number>();
  normalizedSeriesLabels.forEach((label, index) => {
    if (!label) return;
    const firstIndex = firstIndexByLabel.get(label);
    if (firstIndex === undefined) firstIndexByLabel.set(label, index);
    else {
      duplicateSeriesIndexes.add(firstIndex);
      duplicateSeriesIndexes.add(index);
    }
  });
  const formIsValid = Boolean(widgetTitle.trim())
    && (sourceMode === 'new'
      ? Boolean(definitionName.trim() && unit.trim() && newSeriesCount > 0)
        && newSeriesLabels.length === newSeriesCount
        && newSeriesLabels.every((label) => Boolean(label.trim()))
        && duplicateSeriesIndexes.size === 0
      : seriesValidation === null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    const requestId = ++previewRequest.current;
    const ids = selectedSeriesKey ? selectedSeriesKey.split('\u0000') : [];
    if (sourceMode !== 'existing' || ids.length === 0) {
      setPreviewSeries([]);
      setPreviewLoading(false);
      setPreviewError(false);
      return () => { previewRequest.current += 1; };
    }

    setPreviewLoading(true);
    setPreviewError(false);
    void loadKpiSeriesPreview(context.departmentId, ids, periodCount)
      .then((series) => {
        if (previewRequest.current !== requestId) return;
        setPreviewSeries(series);
        setPreviewLoading(false);
      })
      .catch((error: unknown) => {
        if (previewRequest.current !== requestId) return;
        onRequestError(error);
        setPreviewSeries([]);
        setPreviewError(true);
        setPreviewLoading(false);
      });
    return () => { previewRequest.current += 1; };
  }, [context.departmentId, onRequestError, periodCount, selectedSeriesKey, sourceMode]);

  function closeDialog() {
    dialogRef.current?.close();
  }

  function handleClose() {
    if (completed.current) return;
    onDismiss(createdDefinition.current?.definitionId ?? null);
  }

  function toggleSeries(seriesId: string) {
    setSelectedSeriesIds((current) => current.includes(seriesId)
      ? current.filter((id) => id !== seriesId)
      : current.length >= 10 ? current : [...current, seriesId]);
    setFailedStep(null);
  }

  function changeNewSeriesCount(count: number) {
    setNewSeriesCount(count);
    setNewSeriesLabels((current) => Array.from({ length: count }, (_, index) => current[index] ?? ''));
    setFailedStep(null);
  }

  function changeNewSeriesLabel(index: number, label: string) {
    setNewSeriesLabels((current) => current.map((currentLabel, currentIndex) => currentIndex === index ? label : currentLabel));
    setFailedStep(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setAttemptedSubmit(true);
    if (!formIsValid || saving || !layoutReady) return;

    setSaving(true);
    setFailedStep(null);
    const targetDashboardId = context.dashboardId;
    try {
      let seriesIds: string[];
      if (sourceMode === 'new') {
        let definition = createdDefinition.current;
        if (!definition) {
          try {
            definition = await createKpiDefinition(context.departmentId, {
              name: definitionName.trim(),
              description: definitionDescription.trim() || null,
              unit: unit.trim(),
              precision,
              cadence,
              seriesLabels: newSeriesLabels.map((label) => label.trim()),
            });
            createdDefinition.current = definition;
            setCreatedDefinitionName(definition.name);
            onDefinitionCreated(definition);
          } catch (error) {
            onRequestError(error);
            setFailedStep('definition');
            return;
          }
        }
        seriesIds = definition.series.map((series) => series.seriesId);
      } else {
        seriesIds = selectedSeriesIds;
      }

      try {
        const rowSpan = getKpiGridRowSpan(gridWidth, gridHeight, gridContainerWidth);
        if (editingWidget) {
          const addTilePosition = getKpiAddTilePosition(layoutWidgets);
          const occupied: KpiGridRectangle[] = layoutWidgets
            .filter((item) => item.widgetId !== editingWidget.widgetId);
          if (addTilePosition) {
            occupied.push({
              ...addTilePosition,
              gridWidth: 6,
              rowSpan: Math.ceil((264 + KPI_GRID_ROW_GAP_PX) / KPI_GRID_ROW_STEP_PX),
            });
          }
          const oldPosition = layoutWidgets.find((item) => item.widgetId === editingWidget.widgetId) ?? editingWidget;
          const position = findNearestKpiGridPosition(
            gridWidth,
            rowSpan,
            { gridX: oldPosition.gridX, gridY: oldPosition.gridY },
            occupied,
          );
          await updateKpiWidget(editingWidget.widgetId, {
            title: widgetTitle.trim(),
            seriesIds,
            ...position,
            gridWidth,
            gridHeight,
            periodCount,
          });
        } else {
          const addTilePosition = getKpiAddTilePosition(layoutWidgets);
          const position = findKpiCreatePosition(layoutWidgets, gridWidth, rowSpan, addTilePosition);
          await createKpiWidget(targetDashboardId, {
            title: widgetTitle.trim(),
            seriesIds,
            ...position,
            gridWidth,
            gridHeight,
            periodCount,
          });
        }
      } catch (error) {
        onRequestError(error);
        setFailedStep('widget');
        return;
      }

      completed.current = true;
      await onCompleted(targetDashboardId);
      closeDialog();
    } finally {
      setSaving(false);
    }
  }

  function updateText(setter: (value: string) => void, value: string) {
    setter(value);
    setFailedStep(null);
  }

  const fieldRequired = m.kpiAddWidgetRequired;
  const errors = {
    definitionName: attemptedSubmit && sourceMode === 'new' && !definitionName.trim() ? fieldRequired : null,
    unit: attemptedSubmit && sourceMode === 'new' && !unit.trim() ? fieldRequired : null,
    seriesCount: attemptedSubmit && sourceMode === 'new' && newSeriesCount === 0 ? fieldRequired : null,
    widgetTitle: attemptedSubmit && !widgetTitle.trim() ? fieldRequired : null,
  };
  const seriesLabelErrors = newSeriesLabels.map((label, index) => attemptedSubmit && sourceMode === 'new'
    ? !label.trim() ? fieldRequired : duplicateSeriesIndexes.has(index) ? m.kpiAddWidgetDistinctSeries : null
    : null);

  let previewEmptyMessage = m.kpiAddWidgetPreviewEmpty;
  if (sourceMode === 'existing') {
    if (selectedSeriesIds.length === 0) previewEmptyMessage = m.kpiAddWidgetSelectSeries;
    else if (seriesValidation !== null) previewEmptyMessage = getKpiSeriesValidationMessage(m, seriesValidation);
    else if (previewLoading) previewEmptyMessage = m.kpiAddWidgetPreviewLoading;
    else if (previewError) previewEmptyMessage = m.kpiAddWidgetPreviewError;
  }
  const previewSeriesForChart = sourceMode === 'existing' && seriesValidation === null ? previewSeries : [];
  const previewLegend = sourceMode === 'new'
    ? newSeriesLabels.map((label, index) => ({
      label: label.trim() || m.kpiSeriesIndexed.replace('{count}', String(index + 1)),
      unit: unit.trim() || '—',
    }))
    : selectedChoices.map((choice) => ({ label: choice.label, unit: choice.unit }));
  const previewCadence = sourceMode === 'new'
    ? cadence
    : selectedChoices[0]?.cadence ?? 'week';
  const previewTitle = widgetTitle.trim() || m.kpiWidgetTitle;
  const previewGridWidth = gridWidth === 6 ? m.kpiHalfWidth : gridWidth === 12 ? m.kpiFullWidth : `${gridWidth}/12`;
  const gridWidthOptions = editingWidget ? Array.from({ length: 10 }, (_, index) => index + 3) : [6, 12];
  const gridHeightOptions = editingWidget ? Array.from({ length: 11 }, (_, index) => index + 2) : [2, 3, 4, 5, 6, 7, 8];
  const failureMessage = failedStep === 'definition'
    ? m.kpiAddWidgetDefinitionFailed
    : failedStep === 'widget'
      ? editingWidget ? m.kpiEditError : m.kpiAddWidgetWidgetFailed
      : null;

  return (
    <dialog
      ref={dialogRef}
      className="kpi-add-widget-dialog"
      aria-labelledby="kpi-add-widget-title"
      onClose={handleClose}
      onCancel={(event) => { if (saving) event.preventDefault(); }}
      onClick={(event) => {
        if (!saving && event.target === event.currentTarget) closeDialog();
      }}
    >
      <div className="kpi-add-widget-dialog-content">
        <header className="kpi-add-widget-header">
          <div>
            <span className="kpi-add-widget-eyebrow">{editingWidget ? m.kpiWidgetSettings : m.kpiAddWidget}</span>
            <h2 id="kpi-add-widget-title">{editingWidget ? m.kpiWidgetSettings : m.kpiAddWidgetHeading}</h2>
          </div>
          <button className="kpi-icon-button" type="button" aria-label={m.kpiClose} disabled={saving} onClick={closeDialog}>×</button>
        </header>

        <div className="kpi-add-widget-context">
          <span><small>{m.kpiAddWidgetFolder}</small><strong>{context.departmentPath}</strong></span>
          <span><small>{m.kpiAddWidgetDashboard}</small><strong>{context.dashboardName}</strong></span>
        </div>

        <form className="kpi-add-widget-form" onSubmit={(event) => void submit(event)}>
          <div className="kpi-add-widget-body">
            <section className="kpi-add-widget-form-pane" aria-label={m.kpiAddWidgetSource}>
              <fieldset className="kpi-add-widget-mode">
                <legend>{m.kpiAddWidgetSource}</legend>
                <label className={sourceMode === 'new' ? 'is-active' : ''}>
                  <input type="radio" name="kpi-add-widget-source" checked={sourceMode === 'new'} onChange={() => setSourceMode('new')} />
                  <span>{m.kpiAddWidgetCreateKpi}</span>
                </label>
                <label className={sourceMode === 'existing' ? 'is-active' : ''}>
                  <input type="radio" name="kpi-add-widget-source" checked={sourceMode === 'existing'} onChange={() => setSourceMode('existing')} />
                  <span>{m.kpiAddWidgetUseExisting}</span>
                </label>
              </fieldset>

              {sourceMode === 'new' ? <div className="kpi-add-widget-fields">
                <label className="kpi-add-field">
                  <span>{m.kpiDefinitionName}</span>
                  <input value={definitionName} maxLength={160} disabled={Boolean(createdDefinitionName)} aria-required="true" aria-invalid={Boolean(errors.definitionName)} onChange={(event) => updateText(setDefinitionName, event.target.value)} />
                  {errors.definitionName && <small className="kpi-field-error">{errors.definitionName}</small>}
                </label>
                <label className="kpi-add-field">
                  <span>{m.kpiDescription}</span>
                  <textarea rows={2} value={definitionDescription} disabled={Boolean(createdDefinitionName)} onChange={(event) => updateText(setDefinitionDescription, event.target.value)} />
                </label>
                <div className="kpi-add-widget-field-pair">
                  <label className="kpi-add-field">
                    <span>{m.kpiUnit}</span>
                    <input value={unit} maxLength={64} placeholder="USD, %, count" disabled={Boolean(createdDefinitionName)} aria-required="true" aria-invalid={Boolean(errors.unit)} onChange={(event) => updateText(setUnit, event.target.value)} />
                    {errors.unit && <small className="kpi-field-error">{errors.unit}</small>}
                  </label>
                  <label className="kpi-add-field">
                    <span>{m.kpiPrecision}</span>
                    <input type="number" min={0} max={8} value={precision} disabled={Boolean(createdDefinitionName)} onChange={(event) => setPrecision(Math.max(0, Math.min(8, Number(event.target.value))))} />
                  </label>
                </div>
                <label className="kpi-add-field">
                  <span>{m.kpiCadence}</span>
                  <select value={cadence} disabled={Boolean(createdDefinitionName)} onChange={(event) => setCadence(event.target.value as KpiCadence)}>
                    <option value="hour">{m.kpiHour}</option><option value="day">{m.kpiDay}</option><option value="week">{m.kpiWeek}</option><option value="month">{m.kpiMonth}</option><option value="year">{m.kpiYear}</option>
                  </select>
                </label>
                <label className="kpi-add-field">
                  <span>{m.kpiSeriesCount}</span>
                  <select value={newSeriesCount} disabled={Boolean(createdDefinitionName)} aria-required="true" aria-invalid={Boolean(errors.seriesCount)} onChange={(event) => changeNewSeriesCount(Number(event.target.value))}>
                    <option value={0}>{m.kpiSeriesCountPlaceholder}</option>
                    {Array.from({ length: 10 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
                  </select>
                  {errors.seriesCount && <small className="kpi-field-error">{errors.seriesCount}</small>}
                </label>
                {newSeriesLabels.length > 0 && <div className="kpi-add-widget-field-pair">
                  {newSeriesLabels.map((label, index) => <label className="kpi-add-field" key={index}>
                    <span>{m.kpiSeriesIndexed.replace('{count}', String(index + 1))}</span>
                    <input value={label} maxLength={120} disabled={Boolean(createdDefinitionName)} aria-required="true" aria-invalid={Boolean(seriesLabelErrors[index])} onChange={(event) => changeNewSeriesLabel(index, event.target.value)} />
                    {seriesLabelErrors[index] && <small className="kpi-field-error">{seriesLabelErrors[index]}</small>}
                  </label>)}
                </div>}
                <label className="kpi-add-field">
                  <span>{m.kpiWidgetTitle}</span>
                  <input value={widgetTitle} maxLength={160} aria-required="true" aria-invalid={Boolean(errors.widgetTitle)} onChange={(event) => updateText(setWidgetTitle, event.target.value)} />
                  {errors.widgetTitle && <small className="kpi-field-error">{errors.widgetTitle}</small>}
                </label>
              </div> : <div className="kpi-add-widget-fields">
                <label className="kpi-add-field">
                  <span>{m.kpiWidgetTitle}</span>
                  <input value={widgetTitle} maxLength={160} aria-required="true" aria-invalid={Boolean(errors.widgetTitle)} onChange={(event) => updateText(setWidgetTitle, event.target.value)} />
                  {errors.widgetTitle && <small className="kpi-field-error">{errors.widgetTitle}</small>}
                </label>
                {!hasSeriesChoices ? <div className="kpi-add-widget-empty-catalog">
                  <p>{m.kpiAddWidgetNoEligibleSeries}</p>
                  <button className="kpi-text-button" type="button" onClick={() => setSourceMode('new')}>{m.kpiAddWidgetCreateKpi}</button>
                </div> : <div className="kpi-add-widget-series-picker" role="group" aria-label={m.kpiAddWidgetUseExisting}>
                  {seriesChoices.map((choice) => <label className="kpi-add-widget-series-option" key={choice.seriesId}>
                    <input type="checkbox" checked={selectedSeriesIds.includes(choice.seriesId)} disabled={!selectedSeriesIds.includes(choice.seriesId) && selectedSeriesIds.length >= 10} onChange={() => toggleSeries(choice.seriesId)} />
                    <span><strong>{choice.label}</strong><small>{choice.definitionName} · {choice.unit} · {cadenceLabel(choice.cadence, m)}</small></span>
                  </label>)}
                </div>}
                {selectedSeriesIds.length > 0 && seriesValidation !== null && <small className="kpi-field-error">{getKpiSeriesValidationMessage(m, seriesValidation)}</small>}
              </div>}
            </section>

            <aside className="kpi-add-widget-preview-pane" aria-label={m.kpiAddWidgetPreview}>
              <div className="kpi-add-widget-preview-card">
                <div className="kpi-add-widget-preview-heading">
                  <div>
                    <span>{m.kpiAddWidgetPreview}</span>
                    <h3>{previewTitle}</h3>
                    <p>{sourceMode === 'new' ? definitionName.trim() || m.kpiDefinitionName : selectedChoices.map((choice) => choice.definitionName).filter((name, index, all) => all.indexOf(name) === index).join(' · ') || m.kpiAddWidgetSelectSeries}</p>
                  </div>
                  <span className="kpi-add-widget-preview-mark" aria-hidden="true">↗</span>
                </div>
                <div className="kpi-add-widget-preview-meta">
                  <span><small>{m.kpiWidgetWidth}</small><strong>{previewGridWidth}</strong></span>
                  <span><small>{m.kpiWidgetHeight}</small><strong>{m.kpiAddWidgetRows.replace('{count}', String(gridHeight))}</strong></span>
                  <span><small>{m.kpiPeriods}</small><strong>{periodCount}</strong></span>
                </div>
                <div className="kpi-add-widget-chart-preview">
                  <PreviewChart
                    title={previewTitle}
                    series={previewSeriesForChart}
                    emptyMessage={previewEmptyMessage}
                  />
                </div>
                <div className="kpi-add-widget-preview-legend">
                  {previewLegend.map((item, index) => <span key={`${item.label}-${index}`}><i style={{ backgroundColor: seriesColors[index % seriesColors.length] }} />{item.label}<small>{item.unit}</small></span>)}
                </div>
                <div className="kpi-add-widget-preview-cadence">{m.kpiCadence}: {cadenceLabel(previewCadence, m)}</div>
              </div>

              <div className="kpi-add-widget-layout-settings">
                <h3>{m.kpiWidgetOptions}</h3>
                <label><span>{m.kpiWidgetWidth}</span><select value={gridWidth} onChange={(event) => setGridWidth(Number(event.target.value))}>
                  {gridWidthOptions.map((width) => <option value={width} key={width}>{width === 6 ? m.kpiHalfWidth : width === 12 ? m.kpiFullWidth : `${width}/12`}</option>)}
                </select></label>
                <label><span>{m.kpiWidgetHeight}</span><select value={gridHeight} onChange={(event) => setGridHeight(Number(event.target.value))}>
                  {gridHeightOptions.map((height) => <option value={height} key={height}>{height}</option>)}
                </select></label>
                <label><span>{m.kpiPeriods}</span><select value={periodCount} onChange={(event) => setPeriodCount(Number(event.target.value))}>
                  {periodCounts.map((count) => <option value={count} key={count}>{count}</option>)}
                </select></label>
              </div>
            </aside>
          </div>

          {failedStep && <div className="kpi-add-widget-submit-error" role="alert">
            {createdDefinitionName && <p>{m.kpiAddWidgetDefinitionCreated.replace('{name}', createdDefinitionName)}</p>}
            <p>{failureMessage}</p>
            <small>{m.kpiAddWidgetRetryNote}</small>
          </div>}

          <footer className="kpi-add-widget-footer">
            <button className="kpi-text-button" type="button" disabled={saving} onClick={closeDialog}>{m.kpiCancelEdit}</button>
            <button className="button kpi-add-widget-submit" type="submit" disabled={saving || !layoutReady}>
              {saving ? (editingWidget ? m.kpiSaving : m.kpiCreating) : (editingWidget ? m.kpiSaveChanges : m.kpiAddWidgetCreateWidget)}
            </button>
          </footer>
        </form>
      </div>
    </dialog>
  );
}

function cadenceLabel(cadence: KpiCadence, m: Messages): string {
  if (cadence === 'hour') return m.kpiHour;
  if (cadence === 'day') return m.kpiDay;
  if (cadence === 'month') return m.kpiMonth;
  if (cadence === 'year') return m.kpiYear;
  return m.kpiWeek;
}

function PreviewChart({
  title,
  series,
  emptyMessage,
}: {
  title: string;
  series: KpiWidgetSeries[];
  emptyMessage: string;
}) {
  const width = 560;
  const height = 180;
  const left = 28;
  const right = 18;
  const top = 16;
  const bottom = 18;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const periods = series[0]?.points.map((point) => point.periodStart) ?? [];
  const periodIndex = new Map(periods.map((period, index) => [period, index]));
  const valuesBySide = {
    left: series.filter((item) => item.axisSide === 'left').flatMap((item) => item.points.map((point) => point.value)),
    right: series.filter((item) => item.axisSide === 'right').flatMap((item) => item.points.map((point) => point.value)),
  };
  const extents = {
    left: getNumericExtent(valuesBySide.left),
    right: getNumericExtent(valuesBySide.right),
  };
  const hasValues = series.some((item) => item.points.some((point) => parseKpiNumber(point.value) !== null));
  const xAt = (index: number) => periods.length <= 1 ? left + plotWidth / 2 : left + index / (periods.length - 1) * plotWidth;
  const yAt = (value: string | null, side: 'left' | 'right') => {
    const parsed = parseKpiNumber(value);
    const extent = extents[side];
    if (parsed === null || !extent) return top + plotHeight;
    return top + plotHeight - ((parsed - extent[0]) / (extent[1] - extent[0])) * plotHeight;
  };

  return <div className="kpi-add-widget-chart" aria-label={title}>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
      {[0, 1, 2, 3].map((line) => {
        const y = top + (plotHeight / 3) * line;
        return <line className="kpi-add-widget-chart-grid" key={line} x1={left} x2={width - right} y1={y} y2={y} />;
      })}
      {hasValues && series.map((item, seriesIndex) => {
        const paths = splitKpiLineSegments(item.points).map((segment) => segment.map((pointIndex, index) => {
          const point = item.points[pointIndex];
          const x = xAt(periodIndex.get(point.periodStart) ?? pointIndex);
          const y = yAt(point.value, item.axisSide);
          return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' '));
        return <g key={item.seriesId}>
          {paths.map((path, pathIndex) => <path key={pathIndex} d={path} className="kpi-add-widget-chart-line" style={{ stroke: seriesColors[seriesIndex % seriesColors.length] }} />)}
          {item.points.map((point, pointIndex) => {
            if (parseKpiNumber(point.value) === null) return null;
            return <circle key={point.periodStart} cx={xAt(periodIndex.get(point.periodStart) ?? pointIndex)} cy={yAt(point.value, item.axisSide)} r="3" className="kpi-add-widget-chart-point" style={{ stroke: seriesColors[seriesIndex % seriesColors.length] }} />;
          })}
        </g>;
      })}
    </svg>
    {!hasValues && <span className="kpi-add-widget-chart-empty">{emptyMessage}</span>}
  </div>;
}
