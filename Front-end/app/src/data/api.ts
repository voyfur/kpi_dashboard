export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null) {
    super(code ?? `KPI API request failed (${status})`);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

export async function requestJson(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Requested-With': 'KPI Dashboards',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (!response.ok) {
    let code: string | null = null;
    try {
      const payload: unknown = await response.json();
      if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.code === 'string') {
        code = payload.error.code;
      }
    } catch {
      // Keep the status when a proxy returns a non-JSON error.
    }
    throw new ApiRequestError(response.status, code);
  }

  if (response.status === 204) return undefined;
  return response.json();
}

export type AuthUser = {
  id: string;
  email: string;
  isAdmin: boolean;
  pages: string[];
};

export async function getCurrentUser(): Promise<AuthUser> {
  return decodeAuthUser(await requestJson('/api/v1/auth/me', 'GET'));
}

export async function login(email: string, password: string): Promise<AuthUser> {
  return decodeAuthUser(await requestJson('/api/v1/auth/login', 'POST', { email, password }));
}

export async function logout(): Promise<void> {
  await requestJson('/api/v1/auth/logout', 'POST', {});
}

function decodeAuthUser(value: unknown): AuthUser {
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.email !== 'string'
    || typeof value.isAdmin !== 'boolean'
    || (value.pages !== undefined && (!Array.isArray(value.pages) || value.pages.some((page) => typeof page !== 'string')))
  ) {
    throw new Error('Invalid KPI identity response');
  }
  return {
    id: value.id,
    email: value.email,
    isAdmin: value.isAdmin,
    pages: (value.pages as string[] | undefined) ?? [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
