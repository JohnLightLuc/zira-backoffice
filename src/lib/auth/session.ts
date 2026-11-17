import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env, isDemo } from "@/lib/env";
import { adminAuth } from "@/lib/firebase/admin";
import { can, ForbiddenError, isStaffRole, type Permission, type StaffRole } from "@/lib/auth/rbac";

/**
 * Staff session (BACKOFFICE_API.md §2).
 * The admin API accepts a Firebase **ID token** (1 h), not a Firebase session cookie, so the
 * `__session` cookie holds the current ID token. The browser keeps it fresh through
 * `onIdTokenChanged` → POST /api/session (components/session-sync.tsx).
 *
 * `StaffSession` is safe to pass to components (no token). The raw token is only reachable
 * through `getStaffToken()`, used by the admin API client.
 */
export const SESSION_COOKIE = "__session";
export const SESSION_MAX_AGE = 60 * 60; // ID token lifetime

export interface StaffSession {
  uid: string;
  email: string;
  name: string;
  initials: string;
  role: StaffRole;
  demo: boolean;
}

interface VerifiedSession {
  session: StaffSession;
  token: string;
}

function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "ST";
}

export function demoToken(uid: string, role: StaffRole) {
  return `demo:${uid}:${role}`;
}

/**
 * Verifies the cookie on every server request: `verifyIdToken(token, checkRevoked = true)` then
 * the `staffRole` custom claim (set only by provisioning). Memoised per request.
 */
const verify = cache(async (): Promise<VerifiedSession | null> => {
  if (isDemo()) {
    const role = env().ZIRA_DEMO_ROLE;
    const session = { uid: "demo-staff", email: "demo@zira.local", name: "Awa Koné", initials: "AK", role, demo: true };
    return { session, token: demoToken(session.uid, role) };
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const decoded = await adminAuth().verifyIdToken(token, true /* checkRevoked */);
    const role = decoded.staffRole;
    if (!isStaffRole(role)) return null;
    const name = (decoded.name as string | undefined) ?? decoded.email ?? "Opérateur";
    return { session: { uid: decoded.uid, email: decoded.email ?? "", name, initials: initialsOf(name), role, demo: false }, token };
  } catch {
    return null;
  }
});

export async function getStaffSession(): Promise<StaffSession | null> {
  return (await verify())?.session ?? null;
}

/** Current staff ID token, forwarded as `Authorization: Bearer` to /admin/v1. Server only. */
export async function getStaffToken(): Promise<string> {
  const v = await verify();
  if (!v) redirect("/login?reason=session_expired");
  return v.token;
}

/** For pages and layouts: redirects to /login when there is no staff session. */
export async function requireStaff(): Promise<StaffSession> {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  return session;
}

/** For pages: renders the 403 page when the role lacks the permission. */
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
