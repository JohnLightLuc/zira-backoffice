import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError, buildUrl, createAdminTransport } from "@/lib/admin-api/core";
import { demoAdminFetch, resetDemoIdempotency } from "@/lib/admin-api/demo-backend";
import { clientAccessSchema, changedFields, subscriptionAdjustmentSchema, updateDeviceSchema, grantStaffSchema, idempotencyKey } from "@/lib/admin-api/schemas";
import type { AdminDeviceList, AuditLogEntry, CursorPage } from "@/lib/admin-api/types";
import { demo } from "@/lib/data/demo-store";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("transport /admin/v1 (BACKOFFICE_API.md §4, §7.3)", () => {
  it("builds the URL with the /admin/v1 prefix and omits empty query values", () => {
    const u = buildUrl("https://api.zira.ci/", "/devices", { status: "online", cursor: undefined, clientId: "", neverSeen: false, limit: 50 });
    expect(u.href).toBe("https://api.zira.ci/admin/v1/devices?status=online&neverSeen=false&limit=50");
  });

  it("sends Bearer token, X-Request-Id, Idempotency-Key, JSON body; unwraps the envelope", async () => {
    const fetchImpl = vi.fn(async (_u: URL | RequestInfo, _init?: RequestInit) => json(200, { success: true, message: "Succès", data: { uid: "u1", disabled: true, changed: true } }, { "x-request-id": "srv-req-123456" }));
    const call = createAdminTransport({ baseUrl: "http://x", getToken: async () => "tok", fetchImpl: fetchImpl as typeof fetch, newRequestId: () => "rid-00000001" });
    const data = await call("/clients/u1/access", { method: "PATCH", body: { disabled: true, reason: "motif valide", extra: undefined }, idempotencyKey: "key-12345678" });
    expect(data).toEqual({ uid: "u1", disabled: true, changed: true });
    const [url, init] = fetchImpl.mock.calls[0]!;
    const h = init!.headers as Record<string, string>;
    expect(String(url)).toBe("http://x/admin/v1/clients/u1/access");
    expect(h.authorization).toBe("Bearer tok");
    expect(h["x-request-id"]).toBe("rid-00000001");
    expect(h["idempotency-key"]).toBe("key-12345678");
    expect(h["content-type"]).toBe("application/json");
    expect(init!.cache).toBe("no-store");
    expect(JSON.parse(String(init!.body))).toEqual({ disabled: true, reason: "motif valide" }); // no undefined key
  });

  it("GET has no body nor content-type", async () => {
    const fetchImpl = vi.fn(async (_u: URL | RequestInfo, _init?: RequestInit) => json(200, { success: true, message: "Succès", data: [] }));
    await createAdminTransport({ baseUrl: "http://x", getToken: async () => "t", fetchImpl: fetchImpl as typeof fetch })("/staff");
    const init = fetchImpl.mock.calls[0]![1]!;
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)["content-type"]).toBeUndefined();
  });

  it("errors carry HTTP status, backend message and request id (header, else ours)", async () => {
    const fetchImpl = vi.fn(async () => json(403, { success: false, message: "Rôle insuffisant pour cette action", data: null }));
    const call = createAdminTransport({ baseUrl: "http://x", getToken: async () => "t", fetchImpl: fetchImpl as typeof fetch, newRequestId: () => "rid-local-1" });
    const err = await call("/staff").catch((e) => e);
    expect(err).toBeInstanceOf(AdminApiError);
    expect(err).toMatchObject({ status: 403, message: "Rôle insuffisant pour cette action", requestId: "rid-local-1" });
  });

  it("401 triggers onUnauthorized (redirect to /login in Next.js)", async () => {
    const onUnauthorized = vi.fn();
    const call = createAdminTransport({ baseUrl: "http://x", getToken: async () => "t", fetchImpl: (async () => json(401, { success: false, message: "Token révoqué", data: null })) as typeof fetch, onUnauthorized });
    await expect(call("/health")).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("non-JSON or success:false bodies become errors; network failures map to 503/504", async () => {
    const html = createAdminTransport({ baseUrl: "http://x", getToken: async () => "t", fetchImpl: (async () => new Response("<html>", { status: 502 })) as typeof fetch });
    await expect(html("/devices")).rejects.toMatchObject({ status: 502, message: "GPS (Traccar) indisponible." });
    const down = createAdminTransport({ baseUrl: "http://x", getToken: async () => "t", fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch });
    await expect(down("/devices")).rejects.toMatchObject({ status: 503 });
    const slow = createAdminTransport({ baseUrl: "http://x", getToken: async () => "t", fetchImpl: (async () => { throw new DOMException("t", "TimeoutError"); }) as typeof fetch });
    await expect(slow("/devices")).rejects.toMatchObject({ status: 504 });
  });
});

describe("schémas alignés sur les DTO (§7.4)", () => {
  it("reason 5–500 characters", () => {
    expect(clientAccessSchema.safeParse({ disabled: true, reason: "abcd" }).success).toBe(false);
    expect(clientAccessSchema.safeParse({ disabled: true, reason: "abcde" }).success).toBe(true);
    expect(clientAccessSchema.safeParse({ disabled: true, reason: "x".repeat(501) }).success).toBe(false);
  });
  it("Idempotency-Key 8–128 [A-Za-z0-9_-], randomUUID accepted", () => {
    expect(idempotencyKey.safeParse(crypto.randomUUID()).success).toBe(true);
    expect(idempotencyKey.safeParse("short").success).toBe(false);
    expect(idempotencyKey.safeParse("has space 123").success).toBe(false);
  });
  it("subscription adjustment: at least one field, date coherence", () => {
    const future = new Date(Date.now() + 864e5).toISOString(), past = new Date(Date.now() - 864e5).toISOString();
    expect(subscriptionAdjustmentSchema.safeParse({ reason: "motif ok" }).success).toBe(false);
    expect(subscriptionAdjustmentSchema.safeParse({ reason: "motif ok", status: "active", endDate: past }).success).toBe(false);
    expect(subscriptionAdjustmentSchema.safeParse({ reason: "motif ok", status: "expired", endDate: future }).success).toBe(false);
    expect(subscriptionAdjustmentSchema.safeParse({ reason: "motif ok", status: "active", endDate: future }).success).toBe(true);
  });
  it("device update: at least one field, no disabled/attributes", () => {
    expect(updateDeviceSchema.safeParse({ reason: "motif ok" }).success).toBe(false);
    expect(updateDeviceSchema.safeParse({ reason: "motif ok", name: "X" }).success).toBe(true);
    expect(updateDeviceSchema.safeParse({ reason: "motif ok", name: "X", disabled: true }).success).toBe(false);
  });
  it("staff grant requires a valid email and role", () => {
    expect(grantStaffSchema.safeParse({ email: "a@zira.ci", role: "support", reason: "embauche" }).success).toBe(true);
    expect(grantStaffSchema.safeParse({ email: "a@zira.ci", role: "Admin", reason: "embauche" }).success).toBe(false);
  });
  it("changedFields only keeps what the operator modified", () => {
    expect(changedFields({ reason: "r", name: "A", model: "M", phone: undefined }, { name: "A", model: "old" })).toEqual({ reason: "r", model: "M" });
  });
});

describe("contrat de bout en bout (implémentation mémoire de /admin/v1)", () => {
  const as = (role: string, uid = "staff-test") =>
    createAdminTransport({ baseUrl: "http://demo.invalid", getToken: async () => `demo:${uid}:${role}`, fetchImpl: demoAdminFetch as typeof fetch });
  const key = () => crypto.randomUUID();
  beforeEach(() => resetDemoIdempotency());

  it("non-staff token → 403, missing token → 401", async () => {
    await expect(as("Admin")("/health")).rejects.toMatchObject({ status: 403, message: "Accès réservé au personnel Zira" });
    const anon = createAdminTransport({ baseUrl: "http://demo.invalid", getToken: async () => "garbage", fetchImpl: demoAdminFetch as typeof fetch });
    await expect(anon("/health")).rejects.toMatchObject({ status: 401 });
  });

  it("viewer reads devices but every mutation is refused (403)", async () => {
    const viewer = as("viewer");
    await expect(viewer<AdminDeviceList>("/devices")).resolves.toHaveProperty("items");
    await expect(viewer("/devices/6531/disable", { method: "POST", body: { reason: "motif valide" }, idempotencyKey: key() })).rejects.toMatchObject({ status: 403 });
    await expect(viewer("/audit-logs")).rejects.toMatchObject({ status: 403 });
    await expect(viewer("/clients/uid_Lm55Hk20a1Qx/notes")).rejects.toMatchObject({ status: 403 });
  });

  it("strict whitelist: unknown body / query fields → 400", async () => {
    await expect(as("support")("/devices", { query: { q: "x" } })).rejects.toMatchObject({ status: 400 });
    await expect(as("support")("/devices/6531/disable", { method: "POST", body: { reason: "motif valide", foo: 1 } })).rejects.toMatchObject({ status: 400 });
  });

  it("disable → changed:true + audit, then again → changed:false without audit; enable restores", async () => {
    const s = as("support");
    const before = demo.auditLogs.length;
    const r1 = await s<{ changed: boolean }>("/devices/6531/disable", { method: "POST", body: { reason: "boîtier volé" }, idempotencyKey: key() });
    expect(r1.changed).toBe(true);
    expect(demo.auditLogs.length).toBe(before + 1);
    expect(demo.auditLogs[0]).toMatchObject({ action: "device.disable", targetType: "device", targetId: "6531", actorRole: "support", result: "success" });
    const r2 = await s<{ changed: boolean }>("/devices/6531/disable", { method: "POST", body: { reason: "boîtier volé" }, idempotencyKey: key() });
    expect(r2.changed).toBe(false);
    expect(demo.auditLogs.length).toBe(before + 1);
    await s("/devices/6531/enable", { method: "POST", body: { reason: "retrouvé" }, idempotencyKey: key() });
  });

  it("idempotency: same key + same body replays, different body → 422", async () => {
    const s = as("support");
    const k = key();
    const before = demo.auditLogs.length;
    const a = await s<{ changed: boolean }>("/clients/uid_Lm55Hk20a1Qx/access", { method: "PATCH", body: { disabled: true, reason: "demande client" }, idempotencyKey: k });
    const b = await s<{ changed: boolean }>("/clients/uid_Lm55Hk20a1Qx/access", { method: "PATCH", body: { disabled: true, reason: "demande client" }, idempotencyKey: k });
    expect(a).toEqual(b); // replayed: still changed:true, no second effect
    expect(demo.auditLogs.length).toBe(before + 1);
    await expect(s("/clients/uid_Lm55Hk20a1Qx/access", { method: "PATCH", body: { disabled: false, reason: "demande client" }, idempotencyKey: k })).rejects.toMatchObject({ status: 422 });
    await s("/clients/uid_Lm55Hk20a1Qx/access", { method: "PATCH", body: { disabled: false, reason: "remise en service" }, idempotencyKey: key() });
  });

  it("client access: own account → 400, staff target by support → 403, reason too short → 400", async () => {
    await expect(as("support", "demo-staff")("/clients/demo-staff/access", { method: "PATCH", body: { disabled: true, reason: "motif ok" } })).rejects.toMatchObject({ status: 400 });
    await expect(as("support")("/clients/staff_yb/access", { method: "PATCH", body: { disabled: true, reason: "motif ok" } })).rejects.toMatchObject({ status: 403 });
    await expect(as("support")("/clients/uid_Lm55Hk20a1Qx/access", { method: "PATCH", body: { disabled: true, reason: "abc" } })).rejects.toMatchObject({ status: 400 });
  });

  it("link: device already linked to another vehicle → 409; vehicle of another owner → 400", async () => {
    const s = as("support");
    await expect(s("/devices/6531/link", { method: "POST", body: { vehicleId: "veh_gh7710", ownerId: "uid_7Fq2Xa19k9Ze", reason: "installation" } })).rejects.toMatchObject({ status: 409 });
    await expect(s("/devices/9330/link", { method: "POST", body: { vehicleId: "veh_gh7710", ownerId: "uid_Rk2wGv6s9mNa", reason: "installation" } })).rejects.toMatchObject({ status: 400 });
    const ok = await s<{ changed: boolean }>("/devices/9330/link", { method: "POST", body: { vehicleId: "veh_gh7710", ownerId: "uid_7Fq2Xa19k9Ze", reason: "installation" }, idempotencyKey: key() });
    expect(ok.changed).toBe(true);
  });

  it("devices: cursor pagination walks every device once; orphan vehicles on page 1 only", async () => {
    const s = as("viewer");
    const seen: number[] = [];
    let cursor: string | undefined;
    let first = true;
    do {
      const page = await s<AdminDeviceList>("/devices", { query: { limit: 3, cursor } });
      if (first) expect(page.orphanVehicles?.some((o) => o.reason === "DEVICE_NOT_FOUND")).toBe(true);
      else expect(page.orphanVehicles).toBeUndefined();
      first = false;
      seen.push(...page.items.map((d) => d.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(new Set(seen).size).toBe(demo.traccarDevices.length);
    await expect(s("/devices", { query: { cursor: "abc" } })).rejects.toMatchObject({ status: 400 });
    await expect(s("/devices", { query: { clientId: "nobody" } })).rejects.toMatchObject({ status: 404 });
  });

  it("positions: window must be > 0 and ≤ 7 days", async () => {
    const s = as("viewer");
    const to = new Date(), from = new Date(to.getTime() - 8 * 864e5);
    await expect(s("/devices/7720/positions", { query: { from: from.toISOString(), to: to.toISOString() } })).rejects.toMatchObject({ status: 400, message: "Fenêtre limitée à 7 jours" });
    await expect(s("/devices/7720/positions", { query: { from: to.toISOString(), to: from.toISOString() } })).rejects.toMatchObject({ status: 400 });
    const day = await s<unknown[]>("/devices/7720/positions", { query: { from: new Date(to.getTime() - 864e5).toISOString(), to: to.toISOString() } });
    expect(day.length).toBeGreaterThan(0);
  });

  it("subscription adjustment: billing only, before/after, incoherent dates → 400", async () => {
    await expect(as("support")("/subscriptions/uid_Hh41Yc8peR6s/adjustments", { method: "POST", body: { reason: "geste", planId: "Pro" } })).rejects.toMatchObject({ status: 403 });
    const b = as("billing");
    await expect(b("/subscriptions/uid_Hh41Yc8peR6s/adjustments", { method: "POST", body: { reason: "geste", status: "expired" } })).rejects.toMatchObject({ status: 400 });
    await expect(b("/subscriptions/uid_Hh41Yc8peR6s/adjustments", { method: "POST", body: { reason: "geste", planId: "Inconnu" } })).rejects.toMatchObject({ status: 400 });
    const r = await b<{ before: { planId: string }; after: { planId: string; permissions: unknown } }>("/subscriptions/uid_Hh41Yc8peR6s/adjustments", { method: "POST", body: { reason: "geste commercial", planId: "Pro" }, idempotencyKey: key() });
    expect(r.before.planId).toBe("Essentiel");
    expect(r.after.planId).toBe("Pro");
    expect(r.after.permissions).toBeTruthy();
  });

  it("staff: super_admin only; grant existing → 409, unknown email → 404, self → 400", async () => {
    await expect(as("support")("/staff")).rejects.toMatchObject({ status: 403 });
    const root = as("super_admin", "staff_root");
    await expect(root("/staff", { method: "POST", body: { email: "y.brou@zira.local", role: "support", reason: "réorganisation" } })).rejects.toMatchObject({ status: 409 });
    await expect(root("/staff", { method: "POST", body: { email: "inconnu@zira.local", role: "support", reason: "réorganisation" } })).rejects.toMatchObject({ status: 404 });
    await expect(root("/staff/staff_root", { method: "PATCH", body: { role: null, reason: "départ" } })).rejects.toMatchObject({ status: 400 });
    const r = await root<{ changed: boolean; member: { role: string | null } }>("/staff/staff_ob", { method: "PATCH", body: { role: "support", reason: "promotion" }, idempotencyKey: key() });
    expect(r).toMatchObject({ changed: true, member: { role: "support" } });
  });

  it("audit logs: strict equality filters, newest first, cursor", async () => {
    const page = await as("support")<CursorPage<AuditLogEntry>>("/audit-logs", { query: { targetType: "client", targetId: "uid_7Fq2Xa19k9Ze", limit: 1 } });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.targetId).toBe("uid_7Fq2Xa19k9Ze");
    await expect(as("support")("/audit-logs", { query: { cursor: "nope" } })).rejects.toMatchObject({ status: 400, message: "Curseur invalide" });
  });

  it("notes are append-only and require 1–2000 characters", async () => {
    const s = as("support");
    await expect(s("/clients/uid_Lm55Hk20a1Qx/notes", { method: "POST", body: { body: "" } })).rejects.toMatchObject({ status: 400 });
    await expect(s("/clients/uid_Lm55Hk20a1Qx/notes", { method: "POST", body: { body: "x", reason: "nope" } })).rejects.toMatchObject({ status: 400 });
    const n = await s<{ id: string }>("/clients/uid_Lm55Hk20a1Qx/notes", { method: "POST", body: { body: "Appel client" }, idempotencyKey: key() });
    const list = await as("billing")<CursorPage<{ id: string }>>("/clients/uid_Lm55Hk20a1Qx/notes");
    expect(list.items[0]!.id).toBe(n.id);
  });
});
