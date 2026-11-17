import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Server Actions end to end against the in-memory /admin/v1 implementation (demo mode):
 * form validation → role check → API call → ActionResult. Next.js runtime pieces are stubbed.
 */
const role = vi.hoisted(() => ({ current: "super_admin" as "super_admin" | "support" | "billing" | "viewer", uid: "staff_root" }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("NEXT_REDIRECT"); }), unstable_rethrow: (e: unknown) => { if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e; } }));
vi.mock("@/lib/auth/session", async () => {
  const { can, ForbiddenError } = await import("@/lib/auth/rbac");
  const session = () => ({ uid: role.uid, email: "root@zira.local", name: "Root", initials: "R", role: role.current, demo: true });
  return {
    getStaffToken: async () => `demo:${role.uid}:${role.current}`,
    getStaffSession: async () => session(),
    assertPermission: async (p: Parameters<typeof can>[1]) => { if (!can(role.current, p)) throw new ForbiddenError(p); return session(); },
  };
});

process.env.ZIRA_DEMO_MODE = "true";

const actions = await import("@/lib/actions");
const { demo } = await import("@/lib/data/demo-store");
const key = () => crypto.randomUUID();

beforeEach(() => { role.current = "super_admin"; role.uid = "staff_root"; });

describe("Server Actions", () => {
  it("field errors are keyed by field name, without calling the API", async () => {
    const before = demo.auditLogs.length;
    const r = await actions.setClientAccess({ uid: "uid_Lm55Hk20a1Qx", disabled: true, reason: "abc", idempotencyKey: key() });
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(!r.ok && r.fieldErrors?.reason?.[0]).toMatch(/5 caractères/);
    expect(demo.auditLogs.length).toBe(before);
  });

  it("role check gives a clear 403 before the API (UI comfort)", async () => {
    role.current = "viewer";
    const r = await actions.addClientNote({ uid: "uid_Lm55Hk20a1Qx", body: "hello", idempotencyKey: key() });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it("subscription adjustment returns before/after", async () => {
    role.current = "billing";
    const endDate = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10) + "T23:59:59.000Z";
    const r = await actions.adjustSubscription({ uid: "uid_Rk2wGv6s9mNa", reason: "geste commercial", endDate, idempotencyKey: key() });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.after.endDate).toBe(endDate);
    const bad = await actions.adjustSubscription({ uid: "uid_Rk2wGv6s9mNa", reason: "geste commercial", idempotencyKey: key() });
    expect(bad).toMatchObject({ ok: false, status: 400 });
  });

  it("device update sends only changed fields; same value → changed:false message", async () => {
    role.current = "support";
    const r = await actions.updateDevice({ deviceId: "6990", idempotencyKey: key(), fields: { reason: "renommage", name: "Serge-Hilux-2" } });
    expect(r).toMatchObject({ ok: true, changed: true });
    const again = await actions.updateDevice({ deviceId: "6990", idempotencyKey: key(), fields: { reason: "renommage", name: "Serge-Hilux-2" } });
    expect(again).toMatchObject({ ok: true, changed: false, message: expect.stringMatching(/Aucun changement/) });
    const forbidden = await actions.updateDevice({ deviceId: "6990", idempotencyKey: key(), fields: { reason: "renommage", disabled: true } });
    expect(forbidden).toMatchObject({ ok: false, status: 400 });
  });

  it("link conflict surfaces the backend 409", async () => {
    role.current = "support";
    const r = await actions.linkDevice({ deviceId: "6531", vehicleId: "veh_fb0001", ownerId: "uid_Ux90Lw3nc2Te", reason: "installation", idempotencyKey: key() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect([400, 409]).toContain(r.status);
  });

  it("staff: grant then change role then revoke", async () => {
    const g = await actions.grantStaff({ email: "nouvel.agent@zira.local", role: "viewer", reason: "embauche support", idempotencyKey: key() });
    expect(g).toMatchObject({ ok: true, data: { role: "viewer", mfaEnrolled: false } });
    expect(g.ok && g.message).toMatch(/second facteur/);
    const u = await actions.updateStaffRole({ uid: "auth_new01", role: "support", reason: "fin de période d'essai", idempotencyKey: key() });
    expect(u).toMatchObject({ ok: true, changed: true });
    const rv = await actions.updateStaffRole({ uid: "auth_new01", role: null, reason: "départ de l'entreprise", idempotencyKey: key() });
    expect(rv).toMatchObject({ ok: true, data: { member: { role: null } } });
    const self = await actions.updateStaffRole({ uid: "staff_root", role: "viewer", reason: "test sur soi", idempotencyKey: key() });
    expect(self).toMatchObject({ ok: false, status: 400 });
  });

  it("non super_admin cannot manage staff", async () => {
    role.current = "support";
    expect(await actions.grantStaff({ email: "x@zira.local", role: "viewer", reason: "embauche", idempotencyKey: key() })).toMatchObject({ ok: false, status: 403 });
  });

  it("staff suspension: super_admin suspends and reactivates; support refused (403)", async () => {
    const s1 = await actions.setClientAccess({ uid: "staff_yb", disabled: true, reason: "départ en congé", idempotencyKey: key() });
    expect(s1).toMatchObject({ ok: true, changed: true, data: { disabled: true } });
    expect(demo.staff.find((m) => m.uid === "staff_yb")?.disabled).toBe(true);
    const s2 = await actions.setClientAccess({ uid: "staff_yb", disabled: true, reason: "départ en congé", idempotencyKey: key() });
    expect(s2).toMatchObject({ ok: true, changed: false });
    role.current = "support"; role.uid = "demo-staff";
    expect(await actions.setClientAccess({ uid: "staff_yb", disabled: false, reason: "retour de congé", idempotencyKey: key() })).toMatchObject({ ok: false, status: 403 });
    role.current = "super_admin"; role.uid = "staff_root";
    expect(await actions.setClientAccess({ uid: "staff_yb", disabled: false, reason: "retour de congé", idempotencyKey: key() })).toMatchObject({ ok: true, changed: true });
    expect(await actions.setClientAccess({ uid: "staff_root", disabled: true, reason: "test sur soi", idempotencyKey: key() })).toMatchObject({ ok: false, status: 400 });
  });
});
