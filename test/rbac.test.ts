import { describe, expect, it } from "vitest";
import { can, PERMISSIONS, STAFF_ROLES, type Permission, type StaffRole } from "@/lib/auth/rbac";

const WRITES = ["clients:suspend", "clients:note", "subscriptions:adjust", "devices:write", "staff:manage"] as const;

/** BACKOFFICE_API.md §3 — route → roles allowed by the backend guard. */
const DOC_MATRIX: [Permission, StaffRole[]][] = [
  ["health:read", ["super_admin", "support", "billing", "viewer"]],
  ["devices:read", ["super_admin", "support", "billing", "viewer"]],
  ["devices:write", ["super_admin", "support"]],
  ["clients:suspend", ["super_admin", "support"]],
  ["clients:notes:read", ["super_admin", "support", "billing"]],
  ["clients:note", ["super_admin", "support"]],
  ["subscriptions:adjust", ["super_admin", "billing"]],
  ["audit:read", ["super_admin", "support", "billing"]],
  ["staff:manage", ["super_admin"]],
];

describe("RBAC mirrors the backend matrix (BACKOFFICE_API.md §3)", () => {
  for (const [permission, roles] of DOC_MATRIX) {
    it(`${permission} → ${roles.join(", ")}`, () => {
      for (const r of STAFF_ROLES) expect(can(r, permission)).toBe(roles.includes(r));
    });
  }
  it("viewer cannot perform any mutation", () => {
    for (const p of WRITES) expect(can("viewer", p)).toBe(false);
  });
  it("viewer cannot export nor read the audit log or notes", () => {
    expect(can("viewer", "clients:export")).toBe(false);
    expect(can("viewer", "audit:read")).toBe(false);
    expect(can("viewer", "clients:notes:read")).toBe(false);
  });
  it("non-staff (no role / unknown role) is denied everything", () => {
    for (const p of PERMISSIONS) {
      expect(can(null, p)).toBe(false);
      expect(can(undefined, p)).toBe(false);
      // @ts-expect-error mobile business role is not a staff role
      expect(can("Admin", p)).toBe(false);
    }
  });
  it("every staff role can read the dashboard", () => {
    for (const r of STAFF_ROLES) expect(can(r, "dashboard:read")).toBe(true);
  });
});
