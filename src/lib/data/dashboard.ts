import "server-only";
import { AggregateField, Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase/admin";
import { isDemo } from "@/lib/env";
import { getDeviceCounts } from "@/lib/data/devices";
import type { Dashboard, Period, SubStatus } from "@/lib/data/types";
import type { StaffSession } from "@/lib/auth/session";

/** Period boundaries in UTC (Abidjan). `custom` falls back to the last 28 days until a date picker sets from/to. */
export function periodRange(period: Period, now = new Date(), custom?: { from?: string; to?: string }) {
  const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const today = startOfDay(now);
  let from: Date, to: Date, buckets: { label: string; from: Date; to: Date }[];
  const dd = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  if (period === "day") {
    from = today; to = new Date(today.getTime() + 864e5);
    buckets = Array.from({ length: 6 }, (_, i) => ({ label: `${i * 4}–${i * 4 + 4} h`, from: new Date(from.getTime() + i * 4 * 3600e3), to: new Date(from.getTime() + (i + 1) * 4 * 3600e3) }));
  } else if (period === "month") {
    from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)); to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    buckets = [];
    for (let s = new Date(from); s < to; s = new Date(s.getTime() + 7 * 864e5)) buckets.push({ label: `S. ${dd(s)}`, from: s, to: new Date(Math.min(s.getTime() + 7 * 864e5, to.getTime())) });
  } else if (period === "custom" && custom?.from && custom?.to) {
    from = startOfDay(new Date(custom.from)); to = new Date(startOfDay(new Date(custom.to)).getTime() + 864e5);
    const days = Math.min(31, Math.round((to.getTime() - from.getTime()) / 864e5));
    buckets = Array.from({ length: days }, (_, i) => ({ label: dd(new Date(from.getTime() + i * 864e5)), from: new Date(from.getTime() + i * 864e5), to: new Date(from.getTime() + (i + 1) * 864e5) }));
  } else {
    const len = period === "custom" ? 28 : 7;
    to = today; from = new Date(today.getTime() - len * 864e5);
    buckets = Array.from({ length: len }, (_, i) => ({ label: dd(new Date(from.getTime() + i * 864e5)), from: new Date(from.getTime() + i * 864e5), to: new Date(from.getTime() + (i + 1) * 864e5) }));
  }
  const span = to.getTime() - from.getTime();
  return { from, to, prevFrom: new Date(from.getTime() - span), prevTo: from, buckets };
}

const STATUSES: SubStatus[] = ["active", "trial", "expiring", "expired", "cancelled", "free"];

export async function getDashboard(period: Period, staff: StaffSession): Promise<Dashboard> {
  const r = periodRange(period);
  const devices = await getDeviceCounts(30, staff).catch(() => null);
  const deviceBlock = { online: devices?.online ?? null, total: devices?.total ?? null, silent: devices?.silent ?? null };

  if (isDemo()) return demoDashboard(period, r, deviceBlock);

  const f = db();
  const ts = (d: Date) => Timestamp.fromDate(d);
  const iso = (d: Date) => d.toISOString();
  const countWhere = async (q: FirebaseFirestore.Query) => (await q.count().get()).data().count;
  const idx = f.collection("admin_client_index");

  const [active, activePrev, news, newsPrev, series, subs, payments, docs] = await Promise.all([
    // projection stores dates as ISO strings (see scripts/backfill-client-index.ts)
    countWhere(idx.where("authDisabled", "==", false).where("lastSignInAt", ">=", iso(r.from)).where("lastSignInAt", "<", iso(r.to))),
    countWhere(idx.where("authDisabled", "==", false).where("lastSignInAt", ">=", iso(r.prevFrom)).where("lastSignInAt", "<", iso(r.prevTo))),
    countWhere(idx.where("createdAt", ">=", iso(r.from)).where("createdAt", "<", iso(r.to))),
    countWhere(idx.where("createdAt", ">=", iso(r.prevFrom)).where("createdAt", "<", iso(r.prevTo))),
    Promise.all(r.buckets.map(async (b) => ({ label: b.label, value: await countWhere(idx.where("createdAt", ">=", iso(b.from)).where("createdAt", "<", iso(b.to))) }))),
    Promise.all(STATUSES.map(async (s) => ({ status: s, count: await countWhere(idx.where("subStatus", "==", s)) }))),
    f.collection("payment_logs").where("date", ">=", ts(r.from)).where("date", "<", ts(r.to))
      .aggregate({ expected: AggregateField.sum("expectedAmount"), received: AggregateField.sum("amountReceived") }).get(),
    (async () => {
      const now = new Date();
      const docsCol = f.collection("documents");
      const [expired, d3, d7] = await Promise.all([
        countWhere(docsCol.where("validTo", "<", ts(now))),
        countWhere(docsCol.where("validTo", ">=", ts(now)).where("validTo", "<", ts(new Date(now.getTime() + 3 * 864e5)))),
        countWhere(docsCol.where("validTo", ">=", ts(new Date(now.getTime() + 3 * 864e5))).where("validTo", "<", ts(new Date(now.getTime() + 7 * 864e5)))),
      ]);
      return { expired, within3Days: d3, within7Days: d7 };
    })(),
  ]);
  const paid = subs.filter((s) => s.status === "active" || s.status === "expiring" || s.status === "trial").reduce((a, s) => a + s.count, 0);
  const trials = subs.find((s) => s.status === "trial")?.count ?? 0;
  const p = payments.data();
  const expected = p.expected ?? 0, received = p.received ?? 0;

  return {
    period, from: r.from.toISOString(), to: new Date(r.to.getTime() - 1).toISOString(),
    activeClients: { value: active, previous: activePrev },
    newAccounts: { value: news, previous: newsPrev },
    paidActiveSubscriptions: { value: paid, trials },
    devicesOnline: deviceBlock,
    newAccountsSeries: series,
    subscriptionsByStatus: subs,
    payments: { expected, received, unpaid: Math.max(0, expected - received), currency: "XOF" },
    documents: docs,
    jobs: null, // Cloud Logging not wired yet (spec §7.6) — the card says so
  };
}

function demoDashboard(period: Period, r: ReturnType<typeof periodRange>, devicesOnline: Dashboard["devicesOnline"]): Dashboard {
  const SERIES: Record<Period, number[]> = { day: [1, 3, 11, 8, 6, 2], week: [14, 22, 18, 27, 19, 9, 31], month: [118, 131, 109, 126, 38], custom: Array.from({ length: 28 }, (_, i) => 10 + ((i * 7) % 23)) };
  const values = SERIES[period];
  const scale = { day: 0.12, week: 1, month: 3.8, custom: 3.2 }[period];
  return {
    period, from: r.from.toISOString(), to: new Date(r.to.getTime() - 1).toISOString(),
    activeClients: { value: Math.round(1284 * (period === "day" ? 0.85 : period === "week" ? 1 : 1.1)), previous: 1244 },
    newAccounts: { value: Math.round(140 * scale), previous: Math.round(125 * scale) },
    paidActiveSubscriptions: { value: 612, trials: 88 },
    devicesOnline,
    newAccountsSeries: r.buckets.map((b, i) => ({ label: b.label, value: values[i % values.length] ?? 0 })),
    subscriptionsByStatus: [{ status: "active", count: 524 }, { status: "trial", count: 88 }, { status: "expiring", count: 41 }, { status: "expired", count: 203 }, { status: "cancelled", count: 37 }, { status: "free", count: 391 }],
    payments: { expected: Math.round(18640000 * scale), received: Math.round(16225000 * scale), unpaid: Math.round(2415000 * scale), currency: "XOF" },
    documents: { expired: 23, within3Days: 17, within7Days: 29 },
    jobs: [
      { name: "checkDocumentExpirations", lastRunAt: new Date(r.to.getTime() - 3600e3).toISOString(), ok: true },
      { name: "generateDailyPaymentLogs", lastRunAt: new Date(r.to.getTime() - 3600e3).toISOString(), ok: true },
      { name: "checkExpiredSubscriptions", lastRunAt: new Date(r.to.getTime() - 3600e3).toISOString(), ok: false },
    ],
  };
}
