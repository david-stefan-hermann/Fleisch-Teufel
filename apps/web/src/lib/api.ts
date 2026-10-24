import type { AiLabelResult, Food, PublicUser, ServerInfo, SessionInfo } from '@ft/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly body: unknown = null,
  ) {
    super(code);
  }
}

/** Thrown when the request could not reach the server (offline, VPN down, cancelled). */
export class OfflineError extends Error {
  constructor() {
    super('offline');
  }
}

/**
 * Thrown when the server did not answer within `timeoutMs`. Not an `OfflineError` on purpose: the
 * request may well have been processed (an analysis was paid for), so callers must not repeat it
 * blindly.
 */
export class TimeoutError extends Error {
  constructor() {
    super('timeout');
  }
}

export async function api<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 15_000, signal: callerSignal, ...rest } = init;
  // The caller's signal (cancel) and the timeout both end the request (linked by hand: Safari before
  // 17.4 has no AbortSignal.any, and the caller's signal must never replace the timeout).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new TimeoutError()), timeoutMs);
  const onCallerAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) onCallerAbort();
  else callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
  let res: Response;
  let text: string;
  try {
    res = await fetch(path, { credentials: 'same-origin', ...rest, signal: controller.signal });
    // The body counts towards the timeout too (a connection that dies mid-body is also "offline").
    text = await res.text();
  } catch {
    if (controller.signal.reason instanceof TimeoutError) throw controller.signal.reason;
    throw new OfflineError();
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const code =
      typeof body === 'object' && body && 'error' in body
        ? String((body as { error: unknown }).error)
        : `http_${res.status}`;
    throw new ApiError(res.status, code, body);
  }
  return body as T;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const endpoints = {
  info: () => api<ServerInfo>('/api/info', { timeoutMs: 5000 }),
  me: () => api<{ user: PublicUser }>('/api/auth/me', { timeoutMs: 5000 }),
  login: (email: string, password: string) =>
    api<{ user: PublicUser }>('/api/auth/login', json({ email, password })),
  register: (email: string, password: string) =>
    api<{ user: PublicUser }>('/api/auth/register', json({ email, password })),
  logout: () => api<{ ok: true }>('/api/auth/logout', json({})),
  sessions: () => api<{ sessions: SessionInfo[] }>('/api/auth/sessions'),
  deleteSession: (id: string) =>
    api<{ ok: true }>(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  deleteAccount: (password: string) =>
    api<{ ok: true }>('/api/auth/account', { ...json({ password }), method: 'DELETE' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    api<{ ok: true }>('/api/auth/password', json({ currentPassword, newPassword })),
  food: (id: string, timeoutMs = 4000) =>
    api<{ food: Food }>(`/api/foods/${encodeURIComponent(id)}`, { timeoutMs }),
  barcode: (ean: string) =>
    api<{ food: Food }>(`/api/foods/barcode/${encodeURIComponent(ean)}`, { timeoutMs: 10_000 }),
  searchOff: (q: string, signal?: AbortSignal) =>
    api<{ foods: Food[]; limited: boolean }>(`/api/foods/search?q=${encodeURIComponent(q)}`, {
      timeoutMs: 10_000,
      ...(signal ? { signal } : {}),
    }),
  aiStatus: () => api<{ enabled: boolean; model: string | null }>('/api/ai/status', { timeoutMs: 5000 }),
  /** Foods picked in an AI review instead of the proposed ones (best effort, see `draftChoices`). */
  aiChoices: (analysisId: string, choices: { name: string; foodId: string }[]) =>
    api<{ ok: true }>('/api/ai/choices', { ...json({ analysisId, choices }), timeoutMs: 10_000 }),
  /** The hint given with an analysis (prefills "Neu analysieren" of a logged group). */
  aiHint: (analysisId: string) =>
    api<{ text: string }>(`/api/ai/analyses/${encodeURIComponent(analysisId)}/hint`, { timeoutMs: 5000 }),
  /** 1 to 3 photos of a food label in one multipart request (field `image` repeated). */
  readLabel: (images: Blob[], signal?: AbortSignal) => {
    const form = new FormData();
    images.forEach((img, i) =>
      form.append('image', new File([img], `label-${i + 1}.jpg`, { type: img.type || 'image/jpeg' })),
    );
    return api<AiLabelResult>('/api/ai/label', {
      method: 'POST',
      body: form,
      timeoutMs: 120_000,
      ...(signal ? { signal } : {}),
    });
  },
};

/** German user-facing message for an error, including the next step. */
export function errorMessage(e: unknown): string {
  if (e instanceof OfflineError)
    return 'Keine Verbindung zum Server. Prüfe WLAN bzw. WireGuard und versuche es erneut.';
  if (e instanceof TimeoutError) return 'Der Server hat zu lange nicht geantwortet. Versuche es erneut.';
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'invalid_credentials':
        return 'E-Mail oder Passwort stimmt nicht.';
      case 'too_many_requests':
        return 'Zu viele Versuche. Bitte warte ein paar Minuten.';
      case 'registration_closed':
        return 'Registrierung ist auf diesem Server geschlossen.';
      case 'email_taken':
        return 'Für diese E-Mail gibt es schon ein Konto. Melde dich an.';
      case 'validation':
        return 'Bitte prüfe deine Eingaben.';
      case 'rate_limited':
      case 'upstream_rate_limited':
        return 'Der Dienst ist gerade ausgelastet. Versuche es in einer Minute erneut.';
      case 'upstream_unavailable':
      case 'upstream_error':
        return 'Der externe Dienst antwortet nicht. Versuche es später erneut.';
      case 'ai_disabled':
      case 'ai_misconfigured':
        return 'Die Foto-Analyse ist auf dem Server nicht eingerichtet.';
      case 'refused':
        return 'Das Foto konnte nicht analysiert werden. Versuche ein anderes Foto oder trage das Essen manuell ein.';
      case 'too_large':
        return 'Das Foto ist zu groß.';
      default:
        return `Fehler (${e.status}). Versuche es erneut.`;
    }
  }
  const name = e instanceof Error ? e.name : '';
  if (/Quota/i.test(name))
    return 'Der Speicher des Geräts ist voll. Lösche Fotos oder Apps und versuche es erneut.';
  if (name === 'ZodError')
    return 'Ein Wert liegt außerhalb des erlaubten Bereichs. Bitte prüfe deine Eingaben.';
  return 'Unerwarteter Fehler. Versuche es erneut.';
}
