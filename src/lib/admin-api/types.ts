/**
 * Contract of the Zira admin API `/admin/v1/*` (fleet_backend, NestJS) — BACKOFFICE_API.md §5.
 * These types describe `data` inside the response envelope. Keep them in sync with the backend
 * DTOs (`src/core/application/dtos/admin-*.ts`, branch feat/backoffice-api).
 */
import type { StaffRole } from "@/lib/auth/rbac";

export type { StaffRole };

// ---------------------------------------------------------------- Common (§4)
export interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data: T | null;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

// ---------------------------------------------------------------- Health (§5.1)
export interface DependencyCheck {
  status: "up" | "down";
  latencyMs: number;
  error?: string;
}
export interface HealthReport {
  status: "ok" | "degraded";
  checkedAt: string;
  checks: { firestore: DependencyCheck; redis: DependencyCheck; traccar: DependencyCheck };
}

// ---------------------------------------------------------------- Devices (§5.2)
export type DeviceIssue =
  | "NO_VEHICLE"
  | "MULTIPLE_VEHICLES"
  | "UNIQUE_ID_MISMATCH"
  | "OWNER_NOT_FOUND"
  | "OWNER_NOT_LINKED_TRACCAR"
  | "OWNER_NO_TRACCAR_PERMISSION";

export interface AdminDeviceItem {
  id: number;
  name: string;
  uniqueId: string;
  model: string | null;
  category: string | null;
  disabled: boolean;
  status: string | null;
  lastUpdate: string | null;
  lastSeenAgeSeconds: number | null;
  vehicle: { id: string; label: string | null; plate: string | null; ownerId: string | null; uniqueId: string | null } | null;
  client: { id: string; email: string | null; name: string | null } | null;
  issues: DeviceIssue[];
}

export interface OrphanVehicle {
  vehicle: { id: string; label: string | null; plate: string | null; ownerId: string | null; deviceId: number | null; uniqueId: string | null };
  reason: "DEVICE_NOT_FOUND" | "DEVICE_NOT_IN_CLIENT_ACCOUNT";
}

export interface AdminDeviceList extends CursorPage<AdminDeviceItem> {
  orphanVehicles?: OrphanVehicle[];
}

export interface DevicesQuery {
  clientId?: string;
  status?: "online" | "offline" | "unknown";
  staleBefore?: string;
  neverSeen?: boolean;
  disabled?: boolean;
  unlinked?: boolean;
  cursor?: string;
  limit?: number;
}

export interface TraccarPosition {
  id: number;
  deviceId: number;
  protocol: string | null;
  serverTime: string;
  deviceTime: string;
  fixTime: string;
  outdated: boolean;
  valid: boolean;
  latitude: number;
  longitude: number;
  altitude: number;
  /** knots (Traccar unit) — ×1.852 for km/h */
  speed: number;
  course: number;
  address: string | null;
  accuracy: number;
  attributes: Record<string, unknown>;
}

export interface AdminDeviceDetail extends AdminDeviceItem {
  phone: string | null;
  contact: string | null;
  groupId: number | null;
  attributes: Record<string, unknown>;
  lastPosition: TraccarPosition | null;
}

export interface AdminUpdateDeviceBody {
  reason: string;
  name?: string;
  uniqueId?: string;
  groupId?: number;
  phone?: string;
  model?: string;
  contact?: string;
  category?: string;
}

export interface DeviceEditableFields {
  name: string;
  uniqueId: string;
  disabled: boolean;
  groupId: number | null;
  phone: string | null;
  model: string | null;
  contact: string | null;
  category: string | null;
}
export interface DeviceMutationResult {
  deviceId: number;
  changed: boolean;
  device: DeviceEditableFields;
}

export interface AdminLinkDeviceBody {
  vehicleId: string;
  ownerId: string;
  reason: string;
}
export interface DeviceLinkResult {
  deviceId: number;
  vehicleId: string;
  ownerId: string;
  changed: boolean;
}

// ---------------------------------------------------------------- Clients (§5.3)
export interface ClientAccessResult {
  uid: string;
  disabled: boolean;
  changed: boolean;
}

export interface ClientNote {
  id: string;
  clientId: string;
  body: string;
  authorUid: string;
  authorEmail: string | null;
  createdAt: string | null;
}

// ---------------------------------------------------------------- Subscriptions (§5.4)
export type AdminSubscriptionStatus = "trial" | "active" | "expired" | "cancelled";

export interface AdminSubscriptionAdjustmentBody {
  reason: string;
  planId?: string;
  status?: AdminSubscriptionStatus;
  endDate?: string;
}

export interface SubscriptionState {
  planId: string | null;
  status: string | null;
  endDate: string | null;
  permissions: Record<string, unknown> | null;
}
export interface SubscriptionAdjustmentResult {
  uid: string;
  before: SubscriptionState;
  after: SubscriptionState;
}

// ---------------------------------------------------------------- Staff (§5.5)
export interface StaffMember {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: StaffRole | null;
  disabled: boolean;
  mfaEnrolled: boolean;
  /** HTTP date format from Firebase ("Mon, 10 Nov 2026 08:00:00 GMT"), not ISO */
  lastSignInTime: string | null;
}

export interface GrantStaffBody {
  email: string;
  role: StaffRole;
  reason: string;
}
export interface StaffUpdateResult {
  member: StaffMember;
  changed: boolean;
}

// ---------------------------------------------------------------- Audit (§5.6)
export const AUDIT_ACTIONS = [
  "client.suspend", "client.reactivate", "client.note.create",
  "subscription.adjust",
  "device.update", "device.disable", "device.enable", "device.link",
  "staff.grant", "staff.update", "staff.revoke",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_TARGET_TYPES = ["client", "subscription", "device", "staff"] as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

export interface AuditLogEntry {
  id: string;
  actorUid: string;
  actorEmail: string | null;
  actorRole: StaffRole;
  requestId: string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  result: "success" | "failure";
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  error: string | null;
  createdAt: string | null;
}

export interface AuditLogsQuery {
  targetType?: AuditTargetType;
  targetId?: string;
  actorUid?: string;
  action?: AuditAction;
  cursor?: string;
  limit?: number;
}
