/**
 * Internal staff roles and permissions (spec §5).
 * Distinct from the mobile business roles (Admin, Gestionnaire, Observateur).
 * Deny by default: a permission not listed for a role is refused.
 */
export const STAFF_ROLES = ["super_admin", "support", "billing", "viewer"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const PERMISSIONS = [
  "dashboard:read",
  "clients:read",
  "clients:suspend",
  "clients:note",
  "clients:export",
  "clients:delete",
  "subscriptions:read",
  "subscriptions:adjust",
  "devices:read",
  "devices:write",
  "documents:open",
  "health:read",
  "audit:read",
  "staff:manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const READ: Permission[] = ["dashboard:read", "clients:read", "subscriptions:read", "devices:read", "health:read"];

const MATRIX: Record<StaffRole, readonly Permission[]> = {
  super_admin: PERMISSIONS,
  support: [...READ, "clients:suspend", "clients:note", "devices:write", "documents:open", "audit:read"],
  billing: [...READ, "subscriptions:adjust", "clients:export", "audit:read"],
  viewer: ["dashboard:read", "clients:read", "subscriptions:read", "devices:read"],
};

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (STAFF_ROLES as readonly string[]).includes(value);
}

export function can(role: StaffRole | null | undefined, permission: Permission): boolean {
  if (!role || !isStaffRole(role)) return false;
  return MATRIX[role].includes(permission);
}

export function permissionsOf(role: StaffRole): Permission[] {
  return [...MATRIX[role]];
}

export class ForbiddenError extends Error {
  readonly code = "FORBIDDEN";
  constructor(public readonly permission: Permission) {
    super(`Permission refusée : ${permission}`);
  }
}
