import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env, isDemo } from "@/lib/env";
import { adminAuth } from "@/lib/firebase/admin";
import { can, ForbiddenError, isStaffRole, type Permission, type StaffRole } from "@/lib/auth/rbac";

export const SESSION_COOKIE = "__session";

export interface StaffSession {
  uid: string;
  email: string;
  name: string;
  initials: string;
  role: StaffRole;
  demo: boolean;
}

function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "ST";
}

/**
 * Reads and verifies the staff session on every server request (spec §5, §8).
 * Role comes from the `staffRole` custom claim, set only by provisioning (never by the app).
 * Returns null when there is no valid staff session. Memoised per request.
 */
export const getStaffSession = cache(async (): Promise<StaffSession | null> => {
  if (isDemo()) {
    const role = env().ZIRA_DEMO_ROLE;
    return { uid: "demo-staff", email: "demo@zira.local", name: "Awa Koné", initials: "AK", role, demo: true };
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const decoded = await adminAuth().verifySessionCookie(token, true /* checkRevoked */);
    const role = decoded.staffRole;
    if (!isStaffRole(role)) return null;
    const name = (decoded.name as string | undefined) ?? decoded.email ?? "Opérateur";
    return { uid: decoded.uid, email: decoded.email ?? "", name, initials: initialsOf(name), role, demo: false };
  } catch {
    return null;
  }
});

/** For pages and layouts: redirects to /login when there is no staff session. */
export async function requireStaff(): Promise<StaffSession> {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  return session;
}

/** For pages: renders the 403 page via notFound-like redirect when the role lacks the permission. */
export async function requirePagePermission(permission: Permission): Promise<StaffSession> {
  const session = await requireStaff();
  if (!can(session.role, permission)) redirect("/forbidden");
  return session;
}

/** For server actions and route handlers: throws instead of redirecting. */
export async function assertPermission(permission: Permission): Promise<StaffSession> {
  const session = await getStaffSession();
  if (!session || !can(session.role, permission)) throw new ForbiddenError(permission);
  return session;
}
