import "server-only";
import { FieldPath, type Query } from "firebase-admin/firestore";
import { adminAuth, db } from "@/lib/firebase/admin";
import { isDemo } from "@/lib/env";
import { demo } from "@/lib/data/demo-store";
import { getClientHistory } from "@/lib/data/audit";
import { getDevicesForOwner, ISSUE_LABEL } from "@/lib/data/devices";
import { adminApi } from "@/lib/admin-api/client";
import { can } from "@/lib/auth/rbac";
import { orNull } from "@/lib/data/safe";
import { decodeCursor, encodeCursor, normalise, queryClientsInMemory, type ClientsQuery } from "@/lib/data/clients-query";
import type { ClientOverview, ClientRow, Device, FleetItem, OrphanVehicleRow, Page, SubStatus, Subscription } from "@/lib/data/types";
import type { StaffSession } from "@/lib/auth/session";

/**
 * Clients list (spec §8).
 * Firebase Auth listUsers is paginated and is not a search engine, so the list reads the
 * server-side projection `admin_client_index/{uid}` (search tokens, plan, status, counts),
 * maintained by scripts/backfill-client-index.ts and a Firestore/Auth trigger (README).
 */
const INDEX = "admin_client_index";
const SORT_FIELD: Record<ClientsQuery["sort"], string> = { name: "nameLower", vehicles: "vehicleCount", lastSignIn: "lastSignInAt", createdAt: "createdAt" };

export async function getClientsPage(q: ClientsQuery): Promise<Page<ClientRow>> {
  if (isDemo()) return queryClientsInMemory(demo.clients, q);

  let query: Query = db().collection(INDEX);
  if (q.plan) query = query.where("plan", "==", q.plan);
  if (q.sub) query = query.where("subStatus", "==", q.sub);
  if (q.q) query = query.where("searchTokens", "array-contains", normalise(q.q));
  query = query.orderBy(SORT_FIELD[q.sort], q.dir).orderBy(FieldPath.documentId(), q.dir);
  const after = decodeCursor(q.cursor);
  if (after) query = query.startAfter(after[0], after[1]);
  const snap = await query.limit(q.size + 1).get();

  const docs = snap.docs.slice(0, q.size);
  const items = docs.map((d) => indexDocToRow(d.id, d.data()));
  const hasMore = snap.docs.length > q.size;
  const last = items[items.length - 1];
  const lastDoc = docs[docs.length - 1];
  return { items, hasMore, nextCursor: hasMore && last && lastDoc ? encodeCursor(rawSortValue(lastDoc.data(), q.sort), last.uid) : null };
}

function rawSortValue(data: FirebaseFirestore.DocumentData, sort: ClientsQuery["sort"]) {
  return data[SORT_FIELD[sort]] ?? null;
}

function iso(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object" && v && "toDate" in v && typeof (v as { toDate: unknown }).toDate === "function") return (v as { toDate(): Date }).toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  return null;
}

function indexDocToRow(uid: string, x: FirebaseFirestore.DocumentData): ClientRow {
  return {
    uid,
    name: x.name ?? "(sans nom)",
    email: x.email ?? null,
    phone: x.phone ?? null,
    plan: x.plan ?? "—",
    subStatus: (x.subStatus as SubStatus) ?? "free",
    subEndDate: iso(x.subEndDate),
    vehicleCount: x.vehicleCount ?? null,
    deviceCount: x.deviceCount ?? null,
    authDisabled: Boolean(x.authDisabled),
    emailVerified: Boolean(x.emailVerified),
    createdAt: iso(x.createdAt),
    lastSignInAt: iso(x.lastSignInAt),
  };
}

/** Maps subscriptions/{uid} to the DTO. `expiring` = active and ending within 7 days. */
export function toSubscription(x: FirebaseFirestore.DocumentData | undefined, now = Date.now()): Subscription | null {
  if (!x) return null;
  const endDate = iso(x.endDate);
  const raw = String(x.status ?? "").toLowerCase();
  let status: SubStatus =
    raw === "active" ? "active" : raw === "trial" || raw === "trialing" ? "trial" : raw === "expired" ? "expired" : raw === "cancelled" || raw === "canceled" ? "cancelled" : "free";
  if (status === "active" && endDate && new Date(endDate).getTime() - now < 7 * 864e5) status = "expiring";
  return { planId: x.planId ?? "—", status, billingCycle: x.billingCycle ?? null, startDate: iso(x.startDate), endDate, trialEndDate: iso(x.trialEndDate), autoRenew: x.autoRenew ?? null };
}

interface VehicleRef { id: string; plate: string | null; label: string; deviceId: string | null; uniqueId: string | null }

/** Support-side reads that depend on the role: audit (not viewer) and notes (not viewer). */
async function supportReads(uid: string, staff: StaffSession) {
  const [audit, notes] = await Promise.all([
    can(staff.role, "audit:read") ? orNull(getClientHistory(uid)) : Promise.resolve(null),
    can(staff.role, "clients:notes:read")
      ? orNull(adminApi.clientNotes(uid, { limit: 20 }).then((p) => p.items.map((n) => ({ id: n.id, body: n.body, author: n.authorEmail ?? n.authorUid, at: n.createdAt }))))
      : Promise.resolve(null),
  ]);
  return { audit, notes };
}

/** Client detail: users/{uid}, subscriptions/{uid}, Auth record, counts by ownerId, fleet, audit, notes. */
export async function getClientOverview(uid: string, staff: StaffSession): Promise<ClientOverview | null> {
  if (isDemo()) {
    const c = demo.clients.find((x) => x.uid === uid);
    if (!c) return null;
    const vehicles: VehicleRef[] = demo.vehiclesOf(uid).map((v) => ({ id: v.id, plate: v.plate, label: v.label ?? "", deviceId: v.deviceId == null ? null : String(v.deviceId), uniqueId: v.uniqueId }));
    const [traccar, reads] = await Promise.all([orNull(getDevicesForOwner(uid)), supportReads(uid, staff)]);
    const fleet = buildFleet(vehicles, traccar);
    return {
      profile: { uid, name: c.name, email: c.email, phone: c.phone, userType: c.userType, role: c.role, traccarUserId: c.traccarUserId, createdAt: c.createdAt },
      auth: { disabled: c.authDisabled, emailVerified: c.emailVerified, createdAt: c.createdAt, lastSignInAt: c.lastSignInAt },
      subscription: demo.subscriptionOf(c),
      counts: { vehicles: c.vehicleCount ?? 0, drivers: c.drivers, assignments: c.assignments, documents: c.documents },
      fleet,
      issues: issuesOf(fleet, traccar?.orphans ?? [], c.traccarUserId),
      ...reads,
      devicesSource: traccar ? "api" : "unavailable",
    };
  }

  const firestore = db();
  const byOwner = (col: string) => firestore.collection(col).where("ownerId", "==", uid);
  const [authUser, userDoc, subDoc, vCount, dCount, aCount, docCount, vehicles] = await Promise.all([
    adminAuth().getUser(uid).catch(() => null),
    firestore.doc(`users/${uid}`).get(),
    firestore.doc(`subscriptions/${uid}`).get(),
    byOwner("vehicles").count().get(),
    byOwner("drivers").count().get(),
    byOwner("assignments").count().get(),
    byOwner("documents").count().get(),
    byOwner("vehicles").select("plate", "registrationNumber", "brand", "label", "year", "deviceId", "uniqueId").limit(50).get(),
  ]);
  if (!authUser && !userDoc.exists) return null;
  const u = userDoc.data() ?? {}; // never spread: traccarPassword / fcmToken stay out

  const [traccar, reads] = await Promise.all([orNull(getDevicesForOwner(uid)), supportReads(uid, staff)]);
  const refs: VehicleRef[] = vehicles.docs.map((v) => {
    const x = v.data();
    return { id: v.id, plate: x.plate ?? x.registrationNumber ?? null, label: [x.brand, x.label, x.year].filter(Boolean).join(" · "), deviceId: x.deviceId != null ? String(x.deviceId) : null, uniqueId: x.uniqueId ?? null };
  });
  const fleet = buildFleet(refs, traccar);
  const traccarUserId = u.traccarUserId ? String(u.traccarUserId) : null;

  return {
    profile: { uid, name: u.name ?? authUser?.displayName ?? "(sans nom)", email: authUser?.email ?? u.email ?? null, phone: u.phoneNumber ?? authUser?.phoneNumber ?? null, userType: u.userType ?? null, role: u.role ?? null, traccarUserId, createdAt: iso(u.createdAt) ?? authUser?.metadata.creationTime ?? null },
    auth: { disabled: authUser?.disabled ?? false, emailVerified: authUser?.emailVerified ?? false, createdAt: authUser ? new Date(authUser.metadata.creationTime).toISOString() : null, lastSignInAt: authUser?.metadata.lastSignInTime ? new Date(authUser.metadata.lastSignInTime).toISOString() : null },
    subscription: toSubscription(subDoc.data()),
    counts: { vehicles: vCount.data().count, drivers: dCount.data().count, assignments: aCount.data().count, documents: docCount.data().count },
    fleet,
    issues: issuesOf(fleet, traccar?.orphans ?? [], traccarUserId),
    ...reads,
    devicesSource: traccar ? "api" : "unavailable",
  };
}

/** Joins the client's vehicles with the devices of its Traccar account (GET /devices?clientId=). */
export function buildFleet(vehicles: VehicleRef[], traccar: { devices: Device[]; orphans: OrphanVehicleRow[] } | null): FleetItem[] {
  return vehicles.map((v) => {
    if (!v.deviceId) return { vehicleId: v.id, plate: v.plate ?? "—", label: v.label, device: null, link: "no_device" as const };
    const device = traccar?.devices.find((d) => d.id === v.deviceId) ?? null;
    const link: FleetItem["link"] = !traccar ? "unverified" : device ? device.link : "missing_in_traccar";
    return { vehicleId: v.id, plate: v.plate ?? "—", label: v.label, device: device ?? stubDevice(v), link };
  });
}

function stubDevice(v: VehicleRef): Device {
  return { id: v.deviceId!, name: v.label || v.deviceId!, uniqueId: v.uniqueId ?? "—", model: null, ownerUid: null, ownerName: null, vehicleId: v.id, vehiclePlate: v.plate, disabled: false, status: null, lastUpdate: null, link: "unverified", issues: [] };
}

const ORPHAN_TEXT: Record<OrphanVehicleRow["reason"], string> = {
  DEVICE_NOT_FOUND: "Traccar ne connaît aucun device",
  DEVICE_NOT_IN_CLIENT_ACCOUNT: "le compte Traccar du client ne voit pas le device",
};

/** Inconsistencies are reported, never fixed implicitly (§5.2). */
export function issuesOf(fleet: FleetItem[], orphans: OrphanVehicleRow[], traccarUserId: string | null): string[] {
  const out = orphans.map((o) => `vehicles/${o.plate ?? o.vehicleId}.deviceId = ${o.deviceId} : ${ORPHAN_TEXT[o.reason]} ${o.deviceId}${traccarUserId ? ` (utilisateur Traccar ${traccarUserId})` : ""}. Rien n'a été corrigé automatiquement.`);
  for (const f of fleet) {
    if (f.link === "inconsistent" && f.device) out.push(`Device ${f.device.id} (${f.plate}) : ${f.device.issues.map((i) => ISSUE_LABEL[i]).join(" ; ")}.`);
  }
  if (!traccarUserId && fleet.some((f) => f.device)) out.push("Client sans compte Traccar (traccarUserId absent) : le rattachement des devices est impossible.");
  return out;
}
