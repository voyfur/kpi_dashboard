import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createKpiDashboard, type KpiDashboardSummary } from '../data/kpiRepository';
import type { Messages } from '../i18n/messages';

type Props = {
  departmentId: string;
  departmentPath: string;
  messages: Messages;
  onCreated: (dashboard: KpiDashboardSummary) => void;
  onDismiss: () => void;
  onRequestError: (error: unknown) => void;
};

export function KpiCreateDashboardDialog({
  departmentId,
  departmentPath,
  messages: m,
  onCreated,
  onDismiss,
  onRequestError,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  function closeDialog() {
    if (!saving) dialogRef.current?.close();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const dashboardName = name.trim();
    if (!dashboardName || saving) return;

    setSaving(true);
    setError(false);
    try {
      const dashboard = await createKpiDashboard(departmentId, dashboardName);
      onCreated(dashboard);
      dialogRef.current?.close();
    } catch (requestError) {
      onRequestError(requestError);
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="kpi-create-dashboard-dialog"
      aria-labelledby="kpi-create-dashboard-title"
      onClose={onDismiss}
      onCancel={(event) => { if (saving) event.preventDefault(); }}
      onClick={(event) => {
        if (!saving && event.target === event.currentTarget) closeDialog();
      }}
    >
      <form className="kpi-create-dashboard-form" onSubmit={(event) => void submit(event)}>
        <header className="kpi-create-dashboard-header">
          <div>
            <span>{m.kpiAddWidgetFolder}</span>
            <strong>{departmentPath}</strong>
          </div>
          <button className="kpi-icon-button" type="button" aria-label={m.kpiClose} disabled={saving} onClick={closeDialog}>×</button>
        </header>
        <div className="kpi-create-dashboard-body">
          <h2 id="kpi-create-dashboard-title">{m.kpiCreateDashboard}</h2>
          <label className="kpi-create-dashboard-name">
            <span>{m.kpiDashboardName}</span>
            <input autoFocus required maxLength={160} value={name} onChange={(event) => { setName(event.target.value); setError(false); }} />
          </label>
          {error && <p className="kpi-create-dashboard-error" role="alert">{m.kpiCreateDashboardError}</p>}
        </div>
        <footer className="kpi-create-dashboard-footer">
          <button className="kpi-text-button" type="button" disabled={saving} onClick={closeDialog}>{m.kpiCancelEdit}</button>
          <button className="button" type="submit" disabled={saving || !name.trim()}>{saving ? m.kpiCreating : m.kpiCreateDashboard}</button>
        </footer>
      </form>
    </dialog>
  );
}
