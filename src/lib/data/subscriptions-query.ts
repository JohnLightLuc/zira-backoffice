import { z } from "zod";
import type { Page, SubStatus } from "@/lib/data/types";
import { decodeCursor, encodeCursor } from "@/lib/data/clients-query";

/**
 * Subscriptions list (BACKOFFICE_API.md §6: `getSubscriptionsPage(filters)` — subscriptions/
 * filtered by status and planId, sorted by endDate). Pure part, shared by Firestore and demo mode.
 *
 * `expiring` is not stored: it is `status == "active"` with an endDate within the next 7 days.
 * Documents without endDate are not listed (Firestore orderBy excludes them).
 */
export const SUBSCRIPTION_FILTERS = ["active", "expiring", "trial", "expired", "cancelled"] as const;
export type SubscriptionFilter = (typeof SUBSCRIPTION_FILTERS)[number];
export const EXPIRING_DAYS = 7;

export const subscriptionsQuerySchema = z.object({
  status: z.enum(SUBSCRIPTION_FILTERS).optional().catch(undefined),
  plan: z.string().trim().max(60).optional().catch(undefined).transform((v) => v || undefined),
  dir: z.enum(["asc", "desc"]).catch("asc").default("asc"),
  cursor: z.string().max(400).optional().catch(undefined),
  size: z.coerce.number().int().min(10).max(100).catch(25).default(25),
});
export type SubscriptionsQuery = z.infer<typeof subscriptionsQuerySchema>;

export interface SubscriptionRow {
  uid: string;
  name: string;
  email: string | null;
  planId: string;
  /** stored value: trial | active | expired | cancelled (anything else shown as is) */
  rawStatus: string;
  status: SubStatus;
  startDate: string | null;
  endDate: string;
  billingCycle: string | null;
  autoRenew: boolean | null;
}

/** Display status: `expiring` = active and ending within EXPIRING_DAYS. */
export function displayStatus(rawStatus: string, endDate: string | null, now = Date.now()): SubStatus {
  const raw = rawStatus.toLowerCase();
  if (raw === "active") return endDate && Date.parse(endDate) - now < EXPIRING_DAYS * 864e5 ? "expiring" : "active";
  if (raw === "trial" || raw === "trialing") return "trial";
  if (raw === "expired") return "expired";
  if (raw === "cancelled" || raw === "canceled") return "cancelled";
  return "free";
}

export function encodeSubCursor(endDateMs: number, uid: string) {
  return encodeCursor(endDateMs, uid);
}
export function decodeSubCursor(cursor: string | undefined): [number, string] | null {
  const c = decodeCursor(cursor);
  return c && typeof c[0] === "number" ? [c[0], c[1]] : null;
}

/** Bounds of the endDate range implied by the filter (expiring only). */
export function endDateRange(q: SubscriptionsQuery, now = Date.now()): { from?: number; to?: number } {
  return q.status === "expiring" ? { from: now, to: now + EXPIRING_DAYS * 864e5 } : {};
}

/** Stored status the Firestore query filters on. */
export function storedStatus(q: SubscriptionsQuery): string | undefined {
  return q.status === "expiring" ? "active" : q.status;
}

/** Same semantics as the Firestore query, for demo mode and tests. */
export function querySubscriptionsInMemory(rows: SubscriptionRow[], q: SubscriptionsQuery, now = Date.now()): Page<SubscriptionRow> {
  const { from, to } = endDateRange(q, now);
  const st = storedStatus(q);
  const sign = q.dir === "asc" ? 1 : -1;
  const key = (r: SubscriptionRow) => Date.parse(r.endDate);
  const sorted = rows
    .filter((r) => !q.plan || r.planId === q.plan)
    .filter((r) => !st || r.rawStatus === st)
    .filter((r) => (from === undefined || key(r) >= from) && (to === undefined || key(r) < to))
    .sort((a, b) => sign * (key(a) - key(b) || a.uid.localeCompare(b.uid)));
  const after = decodeSubCursor(q.cursor);
  const start = after ? sorted.findIndex((r) => sign * (key(r) - after[0] || r.uid.localeCompare(after[1])) > 0) : 0;
  const slice = start < 0 ? [] : sorted.slice(start, start + q.size);
  const hasMore = start >= 0 && start + q.size < sorted.length;
  const last = slice[slice.length - 1];
  return { items: slice, hasMore, nextCursor: hasMore && last ? encodeSubCursor(key(last), last.uid) : null };
}
