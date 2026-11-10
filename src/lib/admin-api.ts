import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import type { StaffSession } from "@/lib/auth/session";

/**
 * Typed client for the Zira admin API (spec §8 "API dédiée").
 * These /admin/v1 routes are PROPOSED routes to create on the Zira backend (NestJS):
 * they do not exist yet. Until ZIRA_ADMIN_API_URL is set, callers fall back to demo data
 * or show "source non connectée"; nothing is faked against production.
 *
 * Contract: JSON, errors {code, message, requestId}, ISO-8601 UTC dates,
 * pagination {items, nextCursor, hasMore}. Every call forwards the staff identity
 * so the backend re-checks the role (the frontend is never the security boundary).
 */
export class AdminApiError extends Error {
  constructor(public status: number, public code: string, message: string, public requestId: string) {
    super(message);
  }
}

const errorSchema = z.object({ code: z.string(), message: z.string(), requestId: z.string().optional() });

interface CallOptions<T> {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  schema: z.ZodType<T>;
  staff: StaffSession;
  requestId: string;
  idempotencyKey?: string;
  timeoutMs?: number;
}

export async function adminApi<T>(path: string, opts: CallOptions<T>): Promise<T> {
  const { ZIRA_ADMIN_API_URL, ZIRA_ADMIN_API_TOKEN } = env();
  if (!ZIRA_ADMIN_API_URL) throw new AdminApiError(503, "ADMIN_API_NOT_CONFIGURED", "API d'administration non configurée", opts.requestId);
  const res = await fetch(new URL(path, ZIRA_ADMIN_API_URL), {
    method: opts.method ?? "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ZIRA_ADMIN_API_TOKEN ?? ""}`,
      "x-request-id": opts.requestId,
      "x-staff-uid": opts.staff.uid,
      "x-staff-role": opts.staff.role,
      ...(opts.idempotencyKey ? { "idempotency-key": opts.idempotencyKey } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const e = errorSchema.safeParse(json);
    throw new AdminApiError(res.status, e.success ? e.data.code : "HTTP_" + res.status, e.success ? e.data.message : res.statusText, opts.requestId);
  }
  return opts.schema.parse(json);
}

// ---- Schemas of the proposed routes -------------------------------------------------

export const deviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  uniqueId: z.string(),
  model: z.string().nullable(),
  ownerUid: z.string().nullable(),
  ownerName: z.string().nullable(),
  vehicleId: z.string().nullable(),
  vehiclePlate: z.string().nullable(),
  disabled: z.boolean(),
  lastUpdate: z.string().nullable(),
  link: z.enum(["ok", "missing_in_traccar", "unlinked", "unverified"]),
});

export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable(), hasMore: z.boolean() });

export const positionSchema = z.object({ at: z.string(), lat: z.number(), lon: z.number(), speedKmh: z.number() });

export const deviceStatsSchema = z.object({ online: z.number(), total: z.number(), silent: z.number(), neverSeen: z.number(), inconsistent: z.number() });

export const okSchema = z.object({ ok: z.literal(true) });
