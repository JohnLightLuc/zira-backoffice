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
  "clients:suspend", // PATCH /admin/v1/clients/:uid/access
  "clients:notes:read", // GET  /admin/v1/clients/:uid/notes
  "clients:note", // POST /admin/v1/clients/:uid/notes
  "clients:export", // local CSV export (Next.js route, audited)
  "subscriptions:read",
  "subscriptions:adjust", // POST /admin/v1/subscriptions/:uid/adjustments
  "devices:read", // GET  /admin/v1/devices*
  "devices:write", // PATCH /devices/:id, POST /devices/:id/{disable,enable,link}
  "documents:open",
  "health:read", // GET  /admin/v1/health
  "audit:read", // GET  /admin/v1/audit-logs
  "staff:manage", // /admin/v1/staff*
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * UI mirror of the backend matrix (BACKOFFICE_API.md §3). Comfort only: the backend answers 403
 * whatever the UI shows. Keep in sync with the backend guards (test/rbac.test.ts checks the table).
 */
const READ: Permission[] = ["dashboard:read", "clients:read", "subscriptions:read", "devices:read", "health:read"];

const MATRIX: Record<StaffRole, readonly Permission[]> = {
  super_admin: PERMISSIONS,
  support: [...READ, "clients:suspend", "clients:notes:read", "clients:note", "devices:write", "documents:open", "audit:read"],
  billing: [...READ, "clients:notes:read", "subscriptions:adjust", "clients:export", "audit:read"],
  viewer: [...READ],
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
