/**
 * Data minimisation (spec §6.1, §9): these fields never leave the server —
 * not in responses, not in props, not in audit logs.
 */
const SECRET_KEYS = new Set([
  "traccarPassword",
  "password",
  "fcmToken",
  "fcmTokens",
  "idToken",
  "refreshToken",
  "accessToken",
  "token",
  "secret",
  "apiKey",
  "signedUrl",
]);

export function redact<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => redact(v)) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.has(k)) continue;
      out[k] = redact(v);
    }
    return out as T;
  }
  return value;
}

/** Audit before/after values: strings only, bounded, secrets removed. */
export function auditValue(field: string, value: unknown): string {
  if (SECRET_KEYS.has(field)) return "[expurgé]";
  const s = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return s.length > 200 ? s.slice(0, 197) + "…" : s;
}
