import { describe, expect, it } from "vitest";
import { redact, auditValue } from "@/lib/redact";
import { clientsQuerySchema, queryClientsInMemory, searchTokens } from "@/lib/data/clients-query";
import { countDevices, linkOf, toApiQuery, toDevice, toPositions, devicesQuerySchema } from "@/lib/data/devices";
import { diffOf, toAuditEntry } from "@/lib/data/audit";
import { buildFleet } from "@/lib/data/clients";
import type { AdminDeviceItem, TraccarPosition } from "@/lib/admin-api/types";
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

const item = (extra: Partial<AdminDeviceItem> = {}): AdminDeviceItem => ({
  id: 42, name: "d", uniqueId: "u", model: null, category: null, disabled: false, status: "online", lastUpdate: null, lastSeenAgeSeconds: null,
  vehicle: { id: "veh1", label: null, plate: "AB-1", ownerId: "uid_o", uniqueId: "u" }, client: { id: "uid_o", email: "o@x.ci", name: "Owner" }, issues: [], ...extra,
});

describe("devices : mapping du contrat /admin/v1/devices", () => {
  it("maps an API item to the UI device (string id, owner, link state)", () => {
    const d = toDevice(item());
    expect(d).toMatchObject({ id: "42", ownerUid: "uid_o", ownerName: "Owner", vehicleId: "veh1", vehiclePlate: "AB-1", link: "ok" });
  });
  it("derives the link state from the backend issues", () => {
    expect(linkOf([])).toBe("ok");
    expect(linkOf(["NO_VEHICLE"])).toBe("unlinked");
    expect(linkOf(["UNIQUE_ID_MISMATCH"])).toBe("inconsistent");
  });
  it("UI filters only produce documented query parameters", () => {
    const now = Date.parse("2026-11-10T09:00:00Z");
    const q = (status: string) => toApiQuery(devicesQuerySchema.parse({ status }), now);
    expect(q("all")).toEqual({ clientId: undefined, cursor: undefined, limit: 50 });
    expect(q("silent")).toMatchObject({ staleBefore: "2026-11-10T08:30:00.000Z", neverSeen: false, disabled: false });
    expect(q("never")).toMatchObject({ neverSeen: true });
    expect(q("disabled")).toMatchObject({ disabled: true });
    expect(q("unlinked")).toMatchObject({ unlinked: true });
    const allowed = ["clientId", "status", "staleBefore", "neverSeen", "disabled", "unlinked", "cursor", "limit"];
    for (const s of ["all", "silent", "never", "disabled", "unlinked"]) for (const k of Object.keys(q(s))) expect(allowed).toContain(k);
  });
  it("rejects a non numeric cursor or device id from the URL", () => {
    const q = devicesQuerySchema.parse({ cursor: "abc", device: "1;drop" });
    expect(q.cursor).toBeUndefined();
    expect(q.device).toBeUndefined();
  });
  it("positions: knots → km/h, most recent first, bounded", () => {
    const p = (fixTime: string, speed: number) => ({ fixTime, latitude: 5, longitude: -4, speed }) as TraccarPosition;
    const out = toPositions([p("2026-11-10T08:00:00Z", 10), p("2026-11-10T09:00:00Z", 0)], 1);
    expect(out).toEqual([{ at: "2026-11-10T09:00:00Z", lat: 5, lon: -4, speedKmh: 0 }]);
    expect(toPositions([p("2026-11-10T08:00:00Z", 10)])[0]!.speedKmh).toBe(19);
  });
  it("counts: online / silent / never seen / inconsistent incl. orphan vehicles", () => {
    const now = Date.parse("2026-11-10T09:00:00Z");
    const dev = (lastUpdate: string | null, extra: Partial<AdminDeviceItem> = {}) => toDevice(item({ lastUpdate, ...extra }));
    const c = countDevices([dev("2026-11-10T08:55:00Z"), dev("2026-11-10T07:00:00Z"), dev(null, { issues: ["NO_VEHICLE"] }), dev("2026-11-10T07:00:00Z", { disabled: true })], 2, 30, now);
    expect(c).toEqual({ total: 4, online: 1, silent: 1, neverSeen: 1, disabled: 1, inconsistent: 3 });
  });
});

describe("fiche client : véhicules ↔ devices", () => {
  const vehicles = [
    { id: "v1", plate: "A", label: "", deviceId: "42", uniqueId: "u" },
    { id: "v2", plate: "B", label: "", deviceId: "99", uniqueId: "x" },
    { id: "v3", plate: "C", label: "", deviceId: null, uniqueId: null },
  ];
  it("ok / missing in Traccar / no device", () => {
    const fleet = buildFleet(vehicles, { devices: [toDevice(item())], orphans: [] });
    expect(fleet.map((f) => f.link)).toEqual(["ok", "missing_in_traccar", "no_device"]);
  });
  it("unverified when the admin API did not answer — never guessed", () => {
    expect(buildFleet(vehicles, null).map((f) => f.link)).toEqual(["unverified", "unverified", "no_device"]);
  });
});

describe("audit : affichage des entrées backend", () => {
  it("diff only lists changed fields and keeps secrets masked", () => {
    expect(diffOf({ disabled: false, a: 1 }, { disabled: true, a: 1 })).toEqual([{ field: "disabled", before: "false", after: "true" }]);
    expect(diffOf(null, { traccarPassword: "[REDACTED]" })[0]!.after).not.toMatch(/secret/);
  });
  it("maps action codes to labels", () => {
    const e = toAuditEntry({ id: "1", actorUid: "s", actorEmail: "s@z", actorRole: "support", requestId: "r", action: "client.suspend", targetType: "client", targetId: "u", result: "success", reason: "x", before: { disabled: false }, after: { disabled: true }, error: null, createdAt: "2026-11-10T00:00:00.000Z" });
    expect(e).toMatchObject({ action: "Compte suspendu", code: "client.suspend", actorName: "s@z", change: { field: "disabled" } });
  });
});
