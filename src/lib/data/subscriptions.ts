import "server-only";
import { FieldPath, Timestamp, type Query } from "firebase-admin/firestore";
import { db } from "@/lib/firebase/admin";
import { isDemo } from "@/lib/env";
import { demo } from "@/lib/data/demo-store";
import type { Page } from "@/lib/data/types";
import {
  decodeSubCursor, displayStatus, encodeSubCursor, endDateRange, querySubscriptionsInMemory, storedStatus,
  type SubscriptionRow, type SubscriptionsQuery,
} from "@/lib/data/subscriptions-query";

/**
 * Reads subscriptions/ with Firebase Admin (no NestJS route, §6). Mutations go through
 * POST /admin/v1/subscriptions/:uid/adjustments (Server Action `adjustSubscription`).
 * Assumes `endDate` is stored as a Firestore Timestamp (ISO strings are tolerated on read).
 * Indexes: firestore.indexes.json (status|planId + endDate + __name__).
 */
function iso(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") return Number.isNaN(Date.parse(v)) ? null : new Date(v).toISOString();
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (typeof v === "object" && v && "toDate" in v && typeof (v as { toDate: unknown }).toDate === "function") return (v as { toDate(): Date }).toDate().toISOString();
  return null;
}

/** name / email only — users docs are never spread (traccarPassword, fcmToken stay server-side). */
async function profiles(uids: string[]) {
  const out = new Map<string, { name: string | null; email: string | null }>();
  for (let i = 0; i < uids.length; i += 30) {
    const chunk = uids.slice(i, i + 30);
    if (!chunk.length) continue;
    const snap = await db().collection("users").where(FieldPath.documentId(), "in", chunk).select("name", "email").get();
    for (const d of snap.docs) out.set(d.id, { name: d.get("name") ?? null, email: d.get("email") ?? null });
  }
  return out;
}

export async function getSubscriptionsPage(q: SubscriptionsQuery, now = Date.now()): Promise<Page<SubscriptionRow>> {
  if (isDemo()) {
    const rows: SubscriptionRow[] = demo.clients
      .filter((c) => c.subStatus !== "free" && c.subEndDate)
      .map((c) => {
        const rawStatus = c.subStatus === "expiring" ? "active" : c.subStatus;
        return { uid: c.uid, name: c.name, email: c.email, planId: c.plan, rawStatus, status: displayStatus(rawStatus, c.subEndDate, now), startDate: c.subStartDate, endDate: c.subEndDate!, billingCycle: c.billingCycle, autoRenew: c.autoRenew };
      });
    return querySubscriptionsInMemory(rows, q, now);
  }

  let query: Query = db().collection("subscriptions");
  if (q.plan) query = query.where("planId", "==", q.plan);
  const st = storedStatus(q);
  if (st) query = query.where("status", "==", st);
  const { from, to } = endDateRange(q, now);
  if (from !== undefined) query = query.where("endDate", ">=", Timestamp.fromMillis(from));
  if (to !== undefined) query = query.where("endDate", "<", Timestamp.fromMillis(to));
  query = query.orderBy("endDate", q.dir).orderBy(FieldPath.documentId(), q.dir);
  const after = decodeSubCursor(q.cursor);
  if (after) query = query.startAfter(Timestamp.fromMillis(after[0]), after[1]);
  const snap = await query.select("planId", "status", "startDate", "endDate", "billingCycle", "autoRenew").limit(q.size + 1).get();

  const docs = snap.docs.slice(0, q.size);
  const names = await profiles(docs.map((d) => d.id));
  const items = docs.flatMap((d): SubscriptionRow[] => {
    const endDate = iso(d.get("endDate"));
    if (!endDate) return [];
    const rawStatus = String(d.get("status") ?? "");
    const p = names.get(d.id);
    return [{
      uid: d.id, name: p?.name ?? "(sans profil)", email: p?.email ?? null, planId: d.get("planId") ?? "—", rawStatus,
      status: displayStatus(rawStatus, endDate, now), startDate: iso(d.get("startDate")), endDate,
      billingCycle: d.get("billingCycle") ?? null, autoRenew: d.get("autoRenew") ?? null,
    }];
  });
  const hasMore = snap.docs.length > q.size;
  const last = docs[docs.length - 1];
  const lastEnd = last ? iso(last.get("endDate")) : null;
  return { items, hasMore, nextCursor: hasMore && last && lastEnd ? encodeSubCursor(Date.parse(lastEnd), last.id) : null };
}
