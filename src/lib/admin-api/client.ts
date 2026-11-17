import "server-only";
import { redirect } from "next/navigation";
import { env, isDemo } from "@/lib/env";
import { getStaffToken } from "@/lib/auth/session";
import { AdminApiError, createAdminTransport, type RequestOptions } from "@/lib/admin-api/core";
import { demoAdminFetch } from "@/lib/admin-api/demo-backend";
import type {
  AdminDeviceDetail, AdminDeviceList, AdminLinkDeviceBody, AdminSubscriptionAdjustmentBody, AdminUpdateDeviceBody, AuditLogEntry,
  AuditLogsQuery, ClientAccessResult, ClientNote, CursorPage, DeviceLinkResult, DeviceMutationResult, DevicesQuery, GrantStaffBody,
  HealthReport, StaffMember, StaffRole, StaffUpdateResult, SubscriptionAdjustmentResult, TraccarPosition,
} from "@/lib/admin-api/types";

export { AdminApiError } from "@/lib/admin-api/core";

/**
 * Typed client of /admin/v1 for Server Components, Server Actions and Route Handlers
 * (BACKOFFICE_API.md §7.3). Never imported by the browser (`server-only`; the API has no CORS).
 *
 * - production / staging: `ADMIN_API_URL` + the staff ID token from the `__session` cookie;
 * - demo mode: same transport, served by the in-memory contract implementation.
 * A 401 (token expired or revoked after a role change / suspension, §2.2) redirects to /login.
 */
export const ADMIN_API_NOT_CONFIGURED = 503;

export async function adminFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const demo = isDemo();
  const baseUrl = demo ? "http://demo.invalid" : env().ADMIN_API_URL;
  if (!baseUrl) throw new AdminApiError(ADMIN_API_NOT_CONFIGURED, "API d'administration non configurée (ADMIN_API_URL).", null);
  const transport = createAdminTransport({
    baseUrl,
    getToken: getStaffToken,
    fetchImpl: demo ? (demoAdminFetch as typeof fetch) : fetch,
    onUnauthorized: () => redirect("/login?reason=session_revoked"),
  });
  return transport<T>(path, opts);
}

const enc = encodeURIComponent;

export const adminApi = {
  health: () => adminFetch<HealthReport>("/health"),

  devices: (q: DevicesQuery = {}) => adminFetch<AdminDeviceList>("/devices", { query: { ...q } }),
  device: (id: number) => adminFetch<AdminDeviceDetail>(`/devices/${id}`),
  positions: (id: number, from: string, to: string) => adminFetch<TraccarPosition[]>(`/devices/${id}/positions`, { query: { from, to } }),
  updateDevice: (id: number, body: AdminUpdateDeviceBody, key: string) =>
    adminFetch<DeviceMutationResult>(`/devices/${id}`, { method: "PATCH", body, idempotencyKey: key }),
  setDeviceDisabled: (id: number, disabled: boolean, reason: string, key: string) =>
    adminFetch<DeviceMutationResult>(`/devices/${id}/${disabled ? "disable" : "enable"}`, { method: "POST", body: { reason }, idempotencyKey: key }),
  linkDevice: (id: number, body: AdminLinkDeviceBody, key: string) =>
    adminFetch<DeviceLinkResult>(`/devices/${id}/link`, { method: "POST", body, idempotencyKey: key }),

  setClientAccess: (uid: string, disabled: boolean, reason: string, key: string) =>
    adminFetch<ClientAccessResult>(`/clients/${enc(uid)}/access`, { method: "PATCH", body: { disabled, reason }, idempotencyKey: key }),
  clientNotes: (uid: string, q: { cursor?: string; limit?: number } = {}) =>
    adminFetch<CursorPage<ClientNote>>(`/clients/${enc(uid)}/notes`, { query: q }),
  addClientNote: (uid: string, body: string, key: string) =>
    adminFetch<ClientNote>(`/clients/${enc(uid)}/notes`, { method: "POST", body: { body }, idempotencyKey: key }),

  adjustSubscription: (uid: string, body: AdminSubscriptionAdjustmentBody, key: string) =>
    adminFetch<SubscriptionAdjustmentResult>(`/subscriptions/${enc(uid)}/adjustments`, { method: "POST", body, idempotencyKey: key }),

  auditLogs: (q: AuditLogsQuery = {}) => adminFetch<CursorPage<AuditLogEntry>>("/audit-logs", { query: { ...q } }),

  staff: () => adminFetch<StaffMember[]>("/staff"),
  grantStaff: (body: GrantStaffBody, key: string) => adminFetch<StaffMember>("/staff", { method: "POST", body, idempotencyKey: key }),
  updateStaffRole: (uid: string, role: StaffRole | null, reason: string, key: string) =>
    adminFetch<StaffUpdateResult>(`/staff/${enc(uid)}`, { method: "PATCH", body: { role, reason }, idempotencyKey: key }),
};
