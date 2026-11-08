import { useState, type FormEvent } from 'react';
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

  if (auth.status === 'loading') {
    return <main className="auth-status" role="status" aria-live="polite">{m.checkingSession}</main>;
  }

  if (auth.status !== 'authenticated' || !auth.user) {
    return <LoginView unavailable={auth.status === 'error'} onRetry={() => void auth.refresh()} />;
  }

  return (
    <>
      <header className="standalone-header">
        <a className="standalone-brand" href="#kpi" aria-label={m.kpiPageTitle}>
          <span className="standalone-brand-mark" aria-hidden="true">K</span>
          <span>LNG Holding</span>
          <span className="standalone-brand-divider" aria-hidden="true">/</span>
          <strong>{m.navKpi}</strong>
        </a>
        <div className="standalone-account">
          <label className="visually-hidden" htmlFor="locale">Language</label>
          <select id="locale" value={locale} onChange={(event) => setLocale(event.target.value as 'en' | 'uk' | 'ru')}>
            <option value="en">English</option>
            <option value="uk">Українська</option>
            <option value="ru">Русский</option>
          </select>
          <span className="standalone-user">{auth.user.email}</span>
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
    </>
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
