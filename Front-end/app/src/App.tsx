import { useEffect, useState, type FormEvent } from 'react';
import { ApiRequestError } from './data/api';
import { AuthProvider, useAuth } from './data/AuthContext';
import { LocaleProvider, useLocale } from './i18n/LocaleProvider';
import { KpiPage } from './pages/KpiPage';

export default function App() {
  return (
    <LocaleProvider>
      <AuthProvider>
        <KpiApplication />
      </AuthProvider>
    </LocaleProvider>
  );
}

function KpiApplication() {
  const auth = useAuth();
  const { locale, setLocale, messages: m } = useLocale();
  const [logoutFailed, setLogoutFailed] = useState(false);
  const [isPrimaryNavCollapsed, setIsPrimaryNavCollapsed] = useState(() => {
    try {
      return typeof window !== 'undefined' && window.localStorage.getItem('kpi-primary-nav-collapsed') === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem('kpi-primary-nav-collapsed', String(isPrimaryNavCollapsed));
    } catch {
      // The navigation remains usable when browser storage is unavailable.
    }
  }, [isPrimaryNavCollapsed]);

  if (auth.status === 'loading') {
    return <main className="auth-status" role="status" aria-live="polite">{m.checkingSession}</main>;
  }

  if (auth.status !== 'authenticated' || !auth.user) {
    return <LoginView unavailable={auth.status === 'error'} onRetry={() => void auth.refresh()} />;
  }

  const userInitial = auth.user.email.trim().slice(0, 1).toLocaleUpperCase();
  const dashboardHref = window.location.pathname.replace(/\/+$/, '') === '/dashboard/kpi'
    ? `${window.location.pathname}${window.location.search}`
    : '/dashboard/kpi';

  return (
    <div className={isPrimaryNavCollapsed ? 'app-shell is-navigation-collapsed' : 'app-shell'}>
      <aside className="app-sidebar" aria-label={m.primaryNavigation}>
        <div className="app-sidebar-top">
          <a className="app-sidebar-brand" href={dashboardHref} aria-label={m.product} title={m.product}>
            <span className="standalone-brand-mark" aria-hidden="true">K</span>
            {!isPrimaryNavCollapsed && <span className="app-sidebar-brand-copy"><strong>{m.product}</strong><small>{m.productDescriptor}</small></span>}
          </a>
          <button
            className="app-sidebar-toggle"
            type="button"
            aria-label={isPrimaryNavCollapsed ? m.expandSidebar : m.collapseSidebar}
            aria-expanded={!isPrimaryNavCollapsed}
            title={isPrimaryNavCollapsed ? m.expandSidebar : m.collapseSidebar}
            onClick={() => setIsPrimaryNavCollapsed((current) => !current)}
          >{isPrimaryNavCollapsed ? '›' : '‹'}</button>
        </div>
        <div className="app-sidebar-section">
          {!isPrimaryNavCollapsed && <span className="app-sidebar-section-label">{m.workspace}</span>}
          <nav aria-label={m.primaryNavigation}>
            <a className="app-nav-link is-active" href={dashboardHref} aria-current="page" title={m.navDashboards}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3.5" y="4" width="17" height="13" rx="2" />
                <path d="M8 21h8M12 17v4" />
                <path d="m7 13 3-3 2 2 4-5" />
              </svg>
              {!isPrimaryNavCollapsed && <span>{m.navDashboards}</span>}
            </a>
          </nav>
        </div>
        <div className="app-sidebar-footer" title={auth.user.email}>
          <span className="app-user-avatar" aria-hidden="true">{userInitial || 'U'}</span>
          {!isPrimaryNavCollapsed && <span className="app-sidebar-user-copy">{auth.user.email}</span>}
        </div>
      </aside>
      <div className="app-main-column">
        <header className="standalone-header">
          <div className="standalone-page-title">
            <span className="section-kicker">{m.navKpi}</span>
            <h1 id="kpi-page-title">{m.kpiPageTitle}</h1>
          </div>
          <div className="standalone-account">
            <span className="standalone-user">{auth.user.email}</span>
            <label className="visually-hidden" htmlFor="locale">Language</label>
            <select id="locale" value={locale} onChange={(event) => setLocale(event.target.value as 'en' | 'uk' | 'ru')}>
              <option value="en">English</option>
              <option value="uk">Українська</option>
              <option value="ru">Русский</option>
            </select>
            <button
              className="button standalone-logout"
              type="button"
              onClick={() => {
                setLogoutFailed(false);
                void auth.logout().catch(() => setLogoutFailed(true));
              }}
            >
              {m.logout}
            </button>
          </div>
        </header>
        {logoutFailed && <div className="standalone-alert" role="alert">{m.logoutFailed}</div>}
        <main className="standalone-main"><KpiPage /></main>
      </div>
    </div>
  );
}

function LoginView({ unavailable, onRetry }: { unavailable: boolean; onRetry: () => void }) {
  const auth = useAuth();
  const { messages: m } = useLocale();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await auth.login(email.trim(), password);
    } catch (caught) {
      if (caught instanceof ApiRequestError && caught.code === 'rate_limited') {
        setError(m.loginRateLimited);
      } else if (caught instanceof ApiRequestError && caught.code === 'invalid_credentials') {
        setError(m.loginInvalidCredentials);
      } else {
        setError(m.authUnavailable);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="standalone-brand standalone-brand-login">
          <span className="standalone-brand-mark" aria-hidden="true">K</span>
          <span>LNG Holding</span>
        </div>
        <span className="section-kicker">{m.navKpi}</span>
        <h1 id="login-title">{m.loginTitle}</h1>
        <p>{m.loginIntro}</p>
        {unavailable && (
          <div className="login-notice" role="alert">
            <span>{m.authUnavailable}</span>
            <button className="kpi-text-button" type="button" onClick={onRetry}>{m.retry}</button>
          </div>
        )}
        <form className="login-form" onSubmit={(event) => void submit(event)}>
          <label>{m.workEmail}<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required /></label>
          <label>{m.password}<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
          {error && <p className="login-error" role="alert">{error}</p>}
          <button className="button login-submit" type="submit" disabled={submitting}>{submitting ? m.kpiSaving : m.signIn}</button>
        </form>
      </section>
    </main>
  );
}
