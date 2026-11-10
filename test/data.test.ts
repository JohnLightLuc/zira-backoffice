import { describe, expect, it } from "vitest";
import { redact, auditValue } from "@/lib/redact";
import { clientsQuerySchema, queryClientsInMemory, searchTokens } from "@/lib/data/clients-query";
import { matchesFilter } from "@/lib/data/devices";
import type { ClientRow, Device } from "@/lib/data/types";

describe("masquage des données sensibles (spec §6.1, §9)", () => {
  it("removes traccarPassword, fcmToken and tokens at any depth", () => {
    const out = redact({ name: "A", traccarPassword: "x", fcmToken: "y", nested: [{ idToken: "z", ok: 1 }] });
    expect(out).toEqual({ name: "A", nested: [{ ok: 1 }] });
    expect(JSON.stringify(out)).not.toMatch(/traccarPassword|fcmToken|idToken/);
  });
  it("audit values of secret fields are redacted and long values bounded", () => {
    expect(auditValue("traccarPassword", "secret")).toBe("[expurgé]");
    expect(auditValue("note", "x".repeat(500)).length).toBeLessThanOrEqual(200);
  });
});

const mk = (i: number): ClientRow => ({
  uid: `uid_${String(i).padStart(4, "0")}`, name: `Client ${String(i).padStart(4, "0")}`, email: `c${i}@exemple.ci`, phone: `+225 07 00 ${String(i).padStart(4, "0")}`,
  plan: i % 3 === 0 ? "Pro" : "Essentiel", subStatus: i % 5 === 0 ? "expired" : "active", subEndDate: null, vehicleCount: i % 17, deviceCount: 0,
  authDisabled: false, emailVerified: true, createdAt: null, lastSignInAt: null,
});
const rows = Array.from({ length: 237 }, (_, i) => mk(i));

describe("pagination par curseur (spec §11 : couvre toutes les pages)", () => {
  for (const sort of ["name", "vehicles"] as const) {
    for (const dir of ["asc", "desc"] as const) {
      it(`walks every row exactly once (sort=${sort}, dir=${dir})`, () => {
        const seen: string[] = [];
        let cursor: string | undefined;
        let guard = 0;
        do {
          const page = queryClientsInMemory(rows, clientsQuerySchema.parse({ sort, dir, size: 25, cursor }));
          seen.push(...page.items.map((r) => r.uid));
          cursor = page.nextCursor ?? undefined;
          expect(page.hasMore).toBe(Boolean(page.nextCursor));
        } while (cursor && ++guard < 100);
        expect(seen.length).toBe(rows.length);
        expect(new Set(seen).size).toBe(rows.length);
      });
    }
  }
  it("filters by plan and status and searches by name prefix, email or phone", () => {
    const pro = queryClientsInMemory(rows, clientsQuerySchema.parse({ plan: "Pro", size: 100 }));
    expect(pro.items.every((r) => r.plan === "Pro")).toBe(true);
    const expired = queryClientsInMemory(rows, clientsQuerySchema.parse({ sub: "expired", size: 100 }));
    expect(expired.items.every((r) => r.subStatus === "expired")).toBe(true);
    expect(queryClientsInMemory(rows, clientsQuerySchema.parse({ q: "c42@exemple.ci" })).items.map((r) => r.uid)).toEqual(["uid_0042"]);
  });
  it("rejects invalid query values instead of trusting the URL", () => {
    const q = clientsQuerySchema.parse({ sort: "drop table", dir: "sideways", size: "100000" });
    expect(q.sort).toBe("name");
    expect(q.dir).toBe("asc");
    expect(q.size).toBe(25);
  });
  it("search tokens never contain secrets and are accent-insensitive", () => {
    const t = searchTokens({ uid: "U1", name: "Aïcha Koné", email: "a@b.ci", phone: "+225 07 12 34 56 78" });
    expect(t).toContain("aicha");
    expect(t).toContain("kone");
    expect(t).toContain("12345678");
  });
});

describe("filtres devices", () => {
  const now = Date.parse("2026-11-10T09:00:00Z");
  const d = (lastUpdate: string | null, extra: Partial<Device> = {}): Device => ({ id: "1", name: "d", uniqueId: "u", model: null, ownerUid: "o", ownerName: null, vehicleId: null, vehiclePlate: null, disabled: false, lastUpdate, link: "ok", ...extra });
  it("silent = active device older than the threshold", () => {
    expect(matchesFilter(d("2026-11-10T08:00:00Z"), "silent", 30, now)).toBe(true);
    expect(matchesFilter(d("2026-11-10T08:50:00Z"), "silent", 30, now)).toBe(false);
    expect(matchesFilter(d("2026-11-10T08:00:00Z", { disabled: true }), "silent", 30, now)).toBe(false);
  });
  it("never seen and inconsistent", () => {
    expect(matchesFilter(d(null), "never", 30, now)).toBe(true);
    expect(matchesFilter(d(null, { link: "missing_in_traccar" }), "inconsistent", 30, now)).toBe(true);
    expect(matchesFilter(d(null, { link: "ok" }), "inconsistent", 30, now)).toBe(false);
  });
});
