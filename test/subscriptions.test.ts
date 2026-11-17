import { describe, expect, it } from "vitest";
import { displayStatus, querySubscriptionsInMemory, subscriptionsQuerySchema, type SubscriptionRow } from "@/lib/data/subscriptions-query";

const now = Date.parse("2026-11-10T12:00:00Z");
const day = 864e5;
const statuses = ["active", "trial", "expired", "cancelled"];
const rows: SubscriptionRow[] = Array.from({ length: 83 }, (_, i) => {
  const rawStatus = statuses[i % 4]!;
  const endDate = new Date(now + ((i % 20) - 5) * day).toISOString(); // some share the same endDate
  return { uid: `uid_${String(i).padStart(3, "0")}`, name: `C${i}`, email: null, planId: i % 3 ? "Pro" : "Essentiel", rawStatus, status: displayStatus(rawStatus, endDate, now), startDate: null, endDate, billingCycle: null, autoRenew: null };
});
const parse = (o: Record<string, unknown>) => subscriptionsQuerySchema.parse(o);

describe("abonnements : liste", () => {
  for (const dir of ["asc", "desc"] as const) {
    it(`cursor walks every row exactly once, ordered by endDate (${dir}), ties included`, () => {
      const seen: SubscriptionRow[] = [];
      let cursor: string | undefined;
      let guard = 0;
      do {
        const p = querySubscriptionsInMemory(rows, parse({ dir, size: 10, cursor }), now);
        seen.push(...p.items);
        cursor = p.nextCursor ?? undefined;
      } while (cursor && ++guard < 50);
      expect(new Set(seen.map((r) => r.uid)).size).toBe(rows.length);
      const t = seen.map((r) => Date.parse(r.endDate));
      expect(t).toEqual([...t].sort((a, b) => (dir === "asc" ? a - b : b - a)));
    });
  }
  it("expiring = stored active with endDate within 7 days (not past, not later)", () => {
    const p = querySubscriptionsInMemory(rows, parse({ status: "expiring", size: 100 }), now);
    expect(p.items.length).toBeGreaterThan(0);
    for (const r of p.items) {
      expect(r.rawStatus).toBe("active");
      expect(Date.parse(r.endDate)).toBeGreaterThanOrEqual(now);
      expect(Date.parse(r.endDate)).toBeLessThan(now + 7 * day);
      expect(r.status).toBe("expiring");
    }
  });
  it("filters by stored status and plan", () => {
    const p = querySubscriptionsInMemory(rows, parse({ status: "trial", plan: "Pro", size: 100 }), now);
    expect(p.items.every((r) => r.rawStatus === "trial" && r.planId === "Pro")).toBe(true);
  });
  it("display status maps stored values", () => {
    expect(displayStatus("active", new Date(now + 30 * day).toISOString(), now)).toBe("active");
    expect(displayStatus("active", new Date(now + day).toISOString(), now)).toBe("expiring");
    expect(displayStatus("trialing", null, now)).toBe("trial");
    expect(displayStatus("canceled", null, now)).toBe("cancelled");
  });
  it("rejects invalid URL values", () => {
    expect(parse({ status: "free", dir: "up", size: "9999" })).toMatchObject({ status: undefined, dir: "asc", size: 25 });
  });
});
