import { describe, expect, it } from "vitest";
import { can, PERMISSIONS, STAFF_ROLES } from "@/lib/auth/rbac";

const WRITES = ["clients:suspend", "clients:note", "clients:delete", "subscriptions:adjust", "devices:write", "staff:manage"] as const;

describe("RBAC (spec §11)", () => {
  it("viewer cannot perform any mutation", () => {
    for (const p of WRITES) expect(can("viewer", p)).toBe(false);
  });
  it("viewer cannot export nor read the audit log", () => {
    expect(can("viewer", "clients:export")).toBe(false);
    expect(can("viewer", "audit:read")).toBe(false);
  });
  it("non-staff (no role / unknown role) is denied everything", () => {
    for (const p of PERMISSIONS) {
      expect(can(null, p)).toBe(false);
      expect(can(undefined, p)).toBe(false);
      // @ts-expect-error mobile business role is not a staff role
      expect(can("Admin", p)).toBe(false);
    }
  });
  it("only super_admin can delete clients or manage staff", () => {
    for (const r of STAFF_ROLES) {
      expect(can(r, "clients:delete")).toBe(r === "super_admin");
      expect(can(r, "staff:manage")).toBe(r === "super_admin");
    }
  });
  it("support can suspend and disable devices but not adjust subscriptions", () => {
    expect(can("support", "clients:suspend")).toBe(true);
    expect(can("support", "devices:write")).toBe(true);
    expect(can("support", "subscriptions:adjust")).toBe(false);
  });
  it("billing adjusts subscriptions and exports, but cannot suspend", () => {
    expect(can("billing", "subscriptions:adjust")).toBe(true);
    expect(can("billing", "clients:export")).toBe(true);
    expect(can("billing", "clients:suspend")).toBe(false);
  });
  it("every staff role can read the dashboard", () => {
    for (const r of STAFF_ROLES) expect(can(r, "dashboard:read")).toBe(true);
  });
});
