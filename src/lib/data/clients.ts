import "server-only";
import { FieldPath, type Query } from "firebase-admin/firestore";
import { adminAuth, db } from "@/lib/firebase/admin";
import { isDemo } from "@/lib/env";
import { demo } from "@/lib/data/demo-store";
import { listAuditForOwner } from "@/lib/data/audit";
import { getDevicesForOwner } from "@/lib/data/devices";
import { decodeCursor, encodeCursor, normalise, queryClientsInMemory, type ClientsQuery } from "@/lib/data/clients-query";
import type { ClientOverview, ClientRow, FleetItem, Page, SubStatus, Subscription } from "@/lib/data/types";
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

/** Client detail: users/{uid}, subscriptions/{uid}, Auth record, counts by ownerId, fleet, audit. */
export async function getClientOverview(uid: string, staff: StaffSession): Promise<ClientOverview | null> {
  if (isDemo()) {
    const c = demo.clients.find((x) => x.uid === uid);
    if (!c) return null;
    const devices = demo.devices.filter((d) => d.ownerUid === uid);
    const fleet: FleetItem[] = devices.map((d) => ({ vehicleId: d.vehicleId ?? d.id, plate: d.vehiclePlate ?? "—", label: d.vehicleLabel, device: d, link: d.link }));
    if (uid === "uid_7Fq2Xa19k9Ze") fleet.push({ vehicleId: "veh_gh7710", plate: "GH-7710-CI", label: "Toyota Corolla · 2018", device: null, link: "no_device" });
    return {
      profile: { uid, name: c.name, email: c.email, phone: c.phone, userType: c.userType, role: c.role, traccarUserId: c.traccarUserId, createdAt: c.createdAt },
      auth: { disabled: c.authDisabled, emailVerified: c.emailVerified, createdAt: c.createdAt, lastSignInAt: c.lastSignInAt },
      subscription: demo.subscriptionOf(c),
      counts: { vehicles: c.vehicleCount ?? 0, drivers: c.drivers, assignments: c.assignments, documents: c.documents },
      fleet,
      issues: issuesOf(fleet, c.traccarUserId),
      audit: await listAuditForOwner(uid),
    };
  }

  const firestore = db();
  const byOwner = (col: string) => firestore.collection(col).where("ownerId", "==", uid);
  const [authUser, userDoc, subDoc, vCount, dCount, aCount, docCount, vehicles, audit] = await Promise.all([
    adminAuth().getUser(uid).catch(() => null),
    firestore.doc(`users/${uid}`).get(),
    firestore.doc(`subscriptions/${uid}`).get(),
    byOwner("vehicles").count().get(),
    byOwner("drivers").count().get(),
    byOwner("assignments").count().get(),
    byOwner("documents").count().get(),
    byOwner("vehicles").limit(50).get(),
    listAuditForOwner(uid),
  ]);
  if (!authUser && !userDoc.exists) return null;
  const u = userDoc.data() ?? {}; // never spread: traccarPassword / fcmToken stay out

  const devices = await getDevicesForOwner(uid, staff).catch(() => null); // null = admin API not connected
  const fleet: FleetItem[] = vehicles.docs.map((v) => {
    const x = v.data();
    const deviceId = x.deviceId ? String(x.deviceId) : null;
    const device = deviceId && devices ? devices.find((d) => d.id === deviceId) ?? null : null;
    const link: FleetItem["link"] = !deviceId ? "no_device" : !devices ? "unverified" : device ? "ok" : "missing_in_traccar";
    return { vehicleId: v.id, plate: x.plate ?? x.registrationNumber ?? "—", label: [x.brand, x.label, x.year].filter(Boolean).join(" · "), device: device ?? (deviceId ? stubDevice(deviceId, x) : null), link };
  });

  return {
    profile: { uid, name: u.name ?? authUser?.displayName ?? "(sans nom)", email: authUser?.email ?? u.email ?? null, phone: u.phoneNumber ?? authUser?.phoneNumber ?? null, userType: u.userType ?? null, role: u.role ?? null, traccarUserId: u.traccarUserId ? String(u.traccarUserId) : null, createdAt: iso(u.createdAt) ?? authUser?.metadata.creationTime ?? null },
    auth: { disabled: authUser?.disabled ?? false, emailVerified: authUser?.emailVerified ?? false, createdAt: authUser ? new Date(authUser.metadata.creationTime).toISOString() : null, lastSignInAt: authUser?.metadata.lastSignInTime ? new Date(authUser.metadata.lastSignInTime).toISOString() : null },
    subscription: toSubscription(subDoc.data()),
    counts: { vehicles: vCount.data().count, drivers: dCount.data().count, assignments: aCount.data().count, documents: docCount.data().count },
    fleet,
    issues: issuesOf(fleet, u.traccarUserId ? String(u.traccarUserId) : null),
    audit,
  };
}

function stubDevice(id: string, v: FirebaseFirestore.DocumentData) {
  return { id, name: v.label ?? id, uniqueId: v.uniqueId ?? "—", model: null, ownerUid: v.ownerId ?? null, ownerName: null, vehicleId: null, vehiclePlate: v.plate ?? null, disabled: false, lastUpdate: null, link: "unverified" as const };
}

/** Inconsistencies are reported, never fixed implicitly (spec §7.4). */
export function issuesOf(fleet: FleetItem[], traccarUserId: string | null): string[] {
  return fleet
    .filter((f) => f.link === "missing_in_traccar")
    .map((f) => `vehicles/${f.plate}.deviceId = ${f.device?.id}, mais Traccar ne renvoie aucun device ${f.device?.id}${traccarUserId ? ` pour l'utilisateur ${traccarUserId}` : ""}. Rien n'a été corrigé automatiquement.`);
}
