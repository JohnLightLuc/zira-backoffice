import type { ApiEnvelope } from "@/lib/admin-api/types";

/**
 * Framework-free transport for /admin/v1 (BACKOFFICE_API.md §4, §7.3).
 * - `Authorization: Bearer <Firebase ID token>` of the staff member (the backend re-verifies it);
 * - `X-Request-Id` generated per call, `Idempotency-Key` on mutations;
 * - unwraps the `{ success, message, data }` envelope; errors carry the HTTP status
 *   (there is no machine code in the body) and the request id.
 * Wired to the Next.js session in ./client.ts; tested in isolation (test/admin-api.test.ts).
 */
export class AdminApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly requestId: string | null,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

export type QueryValue = string | number | boolean | undefined | null;
export type Query = Record<string, QueryValue>;

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH";
  query?: Query;
  body?: unknown;
  idempotencyKey?: string;
  timeoutMs?: number;
}

export interface TransportConfig {
  baseUrl: string;
  getToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
  newRequestId?: () => string;
  /** Called on 401 (token expired or revoked). May throw (e.g. Next.js redirect). */
  onUnauthorized?: (err: AdminApiError) => void | never;
  defaultTimeoutMs?: number;
}

const REQUEST_ID_RE = /^[\w-]{8,64}$/;

/** Builds `/admin/v1{path}?…`, omitting undefined / null / empty values (strict whitelist, §4.6). */
export function buildUrl(baseUrl: string, path: string, query: Query = {}): URL {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const url = new URL(`${base}/admin/v1${path.startsWith("/") ? path : `/${path}`}`);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, String(v));
  }
  return url;
}

/** Drops undefined keys so optional fields are never serialised (JSON.stringify already does; explicit for nested use). */
function cleanBody(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  return Object.fromEntries(Object.entries(body as Record<string, unknown>).filter(([, v]) => v !== undefined));
}

export function createAdminTransport(cfg: TransportConfig) {
  const doFetch = cfg.fetchImpl ?? fetch;
  const newId = cfg.newRequestId ?? (() => crypto.randomUUID());

  return async function adminFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const token = await cfg.getToken();
    const url = buildUrl(cfg.baseUrl, path, opts.query);
    const requestId = newId();
    const hasBody = opts.body !== undefined;
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "x-request-id": requestId,
    };
    if (hasBody) headers["content-type"] = "application/json";
    if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;

    let res: Response;
    try {
      res = await doFetch(url, {
        method: opts.method ?? "GET",
        headers,
        body: hasBody ? JSON.stringify(cleanBody(opts.body)) : undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(opts.timeoutMs ?? cfg.defaultTimeoutMs ?? 20_000),
      });
    } catch (e) {
      const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      throw new AdminApiError(timeout ? 504 : 503, timeout ? "L'API d'administration ne répond pas (délai dépassé)." : "API d'administration injoignable.", requestId);
    }

    // The header is only set once the guard has passed (absent on 401/403): fall back to ours.
    const headerId = res.headers.get("x-request-id");
    const rid = headerId && REQUEST_ID_RE.test(headerId) ? headerId : requestId;
    const json = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;

    if (!res.ok || !json || json.success !== true) {
      const status = res.ok ? 502 : res.status;
      const err = new AdminApiError(status, json?.message || defaultMessage(status), rid);
      if (status === 401) cfg.onUnauthorized?.(err);
      throw err;
    }
    return json.data as T;
  };
}

export type AdminFetch = ReturnType<typeof createAdminTransport>;

export function defaultMessage(status: number): string {
  switch (status) {
    case 400: return "Requête invalide.";
    case 401: return "Session expirée : reconnectez-vous.";
    case 403: return "Rôle insuffisant pour cette action.";
    case 404: return "Ressource introuvable.";
    case 409: return "Conflit : l'action n'a pas été appliquée.";
    case 422: return "Clé d'idempotence réutilisée avec un contenu différent.";
    case 429: return "Trop de requêtes : réessayez dans un instant.";
    case 502:
    case 504: return "GPS (Traccar) indisponible.";
    default: return `Erreur serveur (HTTP ${status}).`;
  }
}

/** UI conduct per status (§4.3). */
export function errorKind(status: number): "validation" | "auth" | "forbidden" | "not_found" | "conflict" | "rate_limit" | "traccar" | "server" {
  if (status === 400 || status === 422) return "validation";
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limit";
  if (status === 502 || status === 504) return "traccar";
  return "server";
}
