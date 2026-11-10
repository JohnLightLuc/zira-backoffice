/**
 * DTOs normalised at the edge of the system (spec §12.4). Firestore field names stay in the
 * data layer; the UI only sees these shapes. Dates are ISO-8601 UTC strings.
 */
export type Tone = "active" | "maintenance" | "inactive" | "available" | "neutral";

export type SubStatus = "active" | "trial" | "expiring" | "expired" | "cancelled" | "free";
export const SUB_STATUSES: SubStatus[] = ["active", "trial", "expiring", "expired", "cancelled", "free"];

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ClientRow {
  uid: string;
  name: string;
  email: string | null;
  phone: string | null;
  plan: string;
  subStatus: SubStatus;
  subEndDate: string | null;
  vehicleCount: number | null;
  deviceCount: number | null;
  authDisabled: boolean;
  emailVerified: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
}

export interface Subscription {
  planId: string;
  status: SubStatus;
  billingCycle: string | null;
  startDate: string | null;
  endDate: string | null;
  trialEndDate: string | null;
  autoRenew: boolean | null;
}

export type LinkState = "ok" | "missing_in_traccar" | "unlinked" | "unverified";

export interface Device {
  id: string; // Traccar ID
  name: string;
  uniqueId: string;
  model: string | null;
  ownerUid: string | null;
  ownerName: string | null;
  vehicleId: string | null;
  vehiclePlate: string | null;
  disabled: boolean;
  lastUpdate: string | null; // last position time, null = never seen
  link: LinkState;
}

export interface Position {
  at: string;
  lat: number;
  lon: number;
  speedKmh: number;
}

export interface FleetItem {
  vehicleId: string;
  plate: string;
  label: string;
  device: Device | null;
  link: LinkState | "no_device";
}

export interface AuditEntry {
  id: string;
  action: string;
  actorUid: string;
  actorName: string;
  role: string;
  targetType: string;
  targetId: string;
  at: string;
  result: "success" | "failure" | "read";
  requestId: string;
  reason?: string;
  change?: { field: string; before: string; after: string };
}

export interface ClientOverview {
  profile: {
    uid: string;
    name: string;
    email: string | null;
    phone: string | null;
    userType: string | null;
    role: string | null;
    traccarUserId: string | null;
    createdAt: string | null;
  };
  auth: { disabled: boolean; emailVerified: boolean; createdAt: string | null; lastSignInAt: string | null };
  subscription: Subscription | null;
  counts: { vehicles: number; drivers: number; assignments: number; documents: number };
  fleet: FleetItem[];
  issues: string[];
  audit: AuditEntry[];
}

export type Period = "day" | "week" | "month" | "custom";

export interface Metric {
  value: number | null; // null = source not connected
  previous?: number | null;
}

export interface Dashboard {
  period: Period;
  from: string;
  to: string;
  activeClients: Metric;
  newAccounts: Metric;
  paidActiveSubscriptions: Metric & { trials: number | null };
  devicesOnline: { online: number | null; total: number | null; silent: number | null };
  newAccountsSeries: { label: string; value: number }[];
  subscriptionsByStatus: { status: SubStatus; count: number }[];
  payments: { expected: number; received: number; unpaid: number; currency: "XOF" } | null;
  documents: { expired: number; within3Days: number; within7Days: number } | null;
  jobs: { name: string; lastRunAt: string | null; ok: boolean | null }[] | null;
}
