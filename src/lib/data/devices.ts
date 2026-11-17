import "server-only";
import { z } from "zod";
import { isDemo } from "@/lib/env";
import { adminApi } from "@/lib/admin-api/client";
import { minutesSince } from "@/lib/format";
import type { AdminDeviceItem, DeviceIssue, DevicesQuery as ApiDevicesQuery, OrphanVehicle, TraccarPosition } from "@/lib/admin-api/types";
import type { Device, DeviceDetail, LinkState, OrphanVehicleRow, Page, Position } from "@/lib/data/types";

/**
 * Traccar data is only reachable through the admin API (BACKOFFICE_API.md §5.2): the Traccar
 * admin credentials live in the backend; neither this server nor the browser talks to Traccar.
 * Inconsistencies are reported (badges, orphan vehicles), never corrected implicitly.
 */
export const DEVICE_FILTERS = ["all", "silent", "never", "disabled", "unlinked"] as const;
export type DeviceFilter = (typeof DEVICE_FILTERS)[number];

export const devicesQuerySchema = z.object({
  status: z.enum(DEVICE_FILTERS).catch("all").default("all"),
  staleMinutes: z.coerce.number().int().min(5).max(1440).catch(30).default(30),
  clientId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional().catch(undefined),
  cursor: z.string().regex(/^\d{1,12}$/).optional().catch(undefined),
  device: z.string().regex(/^\d{1,12}$/).optional().catch(undefined),
});
export type DevicesQuery = z.infer<typeof devicesQuerySchema>;

export const ISSUE_LABEL: Record<DeviceIssue, string> = {
  NO_VEHICLE: "Aucun véhicule rattaché",
  MULTIPLE_VEHICLES: "Plusieurs véhicules pointent ce device",
  UNIQUE_ID_MISMATCH: "uniqueId du véhicule ≠ uniqueId Traccar",
  OWNER_NOT_FOUND: "Propriétaire du véhicule sans profil users/{uid}",
  OWNER_NOT_LINKED_TRACCAR: "Client sans compte Traccar (traccarUserId)",
  OWNER_NO_TRACCAR_PERMISSION: "Le compte Traccar du client ne voit pas ce device",
};

export const ORPHAN_LABEL: Record<OrphanVehicle["reason"], string> = {
  DEVICE_NOT_FOUND: "Device inexistant dans Traccar",
  DEVICE_NOT_IN_CLIENT_ACCOUNT: "Device absent du compte Traccar du client",
};

export function linkOf(issues: DeviceIssue[]): LinkState {
  if (!issues.length) return "ok";
  return issues.includes("NO_VEHICLE") ? "unlinked" : "inconsistent";
}

export function toDevice(d: AdminDeviceItem): Device {
  return {
    id: String(d.id),
    name: d.name,
    uniqueId: d.uniqueId,
    model: d.model,
    ownerUid: d.client?.id ?? d.vehicle?.ownerId ?? null,
    ownerName: d.client?.name ?? d.client?.email ?? null,
    vehicleId: d.vehicle?.id ?? null,
    vehiclePlate: d.vehicle?.plate ?? null,
    disabled: d.disabled,
    status: d.status,
    lastUpdate: d.lastUpdate,
    link: linkOf(d.issues),
    issues: d.issues,
  };
}

export function toOrphan(o: OrphanVehicle): OrphanVehicleRow {
  return { vehicleId: o.vehicle.id, plate: o.vehicle.plate, label: o.vehicle.label, ownerUid: o.vehicle.ownerId, deviceId: o.vehicle.deviceId == null ? null : String(o.vehicle.deviceId), reason: o.reason };
}

/** Speed in Traccar is in knots. Most recent first, bounded. */
export function toPositions(list: TraccarPosition[], max = 20): Position[] {
  return [...list]
    .sort((a, b) => b.fixTime.localeCompare(a.fixTime))
    .slice(0, max)
    .map((p) => ({ at: p.fixTime, lat: p.latitude, lon: p.longitude, speedKmh: Math.round(p.speed * 1.852) }));
}

/** UI filter → documented query parameters only (strict whitelist on the backend, §4.6). */
export function toApiQuery(q: DevicesQuery, now = Date.now()): ApiDevicesQuery {
  const base: ApiDevicesQuery = { clientId: q.clientId, cursor: q.cursor, limit: 50 };
  switch (q.status) {
    case "silent": return { ...base, staleBefore: new Date(now - q.staleMinutes * 60000).toISOString(), neverSeen: false, disabled: false };
    case "never": return { ...base, neverSeen: true };
    case "disabled": return { ...base, disabled: true };
    case "unlinked": return { ...base, unlinked: true };
    default: return base;
  }
}

export interface DevicesPage extends Page<Device> {
  orphans: OrphanVehicleRow[] | null; // first page only
}

export async function getDevicesPage(q: DevicesQuery): Promise<DevicesPage> {
  const page = await adminApi.devices(toApiQuery(q));
  return { items: page.items.map(toDevice), nextCursor: page.nextCursor, hasMore: page.hasMore, orphans: page.orphanVehicles ? page.orphanVehicles.map(toOrphan) : null };
}

/** Walks every page (limit 100). Guarded: the backend loads all of Traccar on each call. */
async function scanDevices(query: ApiDevicesQuery = {}, maxPages = 50) {
  const items: AdminDeviceItem[] = [];
  let orphans: OrphanVehicle[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const page = await adminApi.devices({ ...query, cursor, limit: 100 });
    items.push(...page.items);
    if (!cursor) orphans = page.orphanVehicles ?? [];
    if (!page.hasMore || !page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return { items, orphans };
}

// Short shared cache for fleet-wide counts (every staff role may read devices). §9: no polling < 30 s.
const COUNTS_TTL_MS = 60_000;
let fleetCache: { at: number; value: Promise<Awaited<ReturnType<typeof scanDevices>>> } | null = null;

export function invalidateDeviceCache() {
  fleetCache = null;
}

async function fleetSnapshot() {
  if (isDemo()) return scanDevices();
  if (!fleetCache || Date.now() - fleetCache.at > COUNTS_TTL_MS) {
    const value = scanDevices();
    fleetCache = { at: Date.now(), value };
    value.catch(() => { if (fleetCache?.value === value) fleetCache = null; });
  }
  return fleetCache.value;
}

export interface DeviceCounts {
  online: number;
  total: number;
  silent: number;
  neverSeen: number;
  disabled: number;
  inconsistent: number;
}

export function countDevices(items: Device[], orphanCount: number, staleMinutes: number, now = Date.now()): DeviceCounts {
  const active = items.filter((d) => !d.disabled);
  const age = (d: Device) => minutesSince(d.lastUpdate, now);
  return {
    total: items.length,
    online: active.filter((d) => (age(d) ?? Infinity) <= staleMinutes).length,
    silent: active.filter((d) => { const a = age(d); return a != null && a > staleMinutes; }).length,
    neverSeen: items.filter((d) => d.lastUpdate == null).length,
    disabled: items.length - active.length,
    inconsistent: items.filter((d) => d.link !== "ok").length + orphanCount,
  };
}

export async function getDeviceCounts(staleMinutes: number): Promise<DeviceCounts> {
  const { items, orphans } = await fleetSnapshot();
  return countDevices(items.map(toDevice), orphans.length, staleMinutes);
}

export async function getDevice(id: string): Promise<DeviceDetail> {
  const n = Number(id);
  const to = new Date();
  const from = new Date(to.getTime() - 24 * 3600 * 1000); // default window 24 h (≤ 7 days, §5.2)
  const [d, positions] = await Promise.all([
    adminApi.device(n),
    adminApi.positions(n, from.toISOString(), to.toISOString()).catch(() => [] as TraccarPosition[]),
  ]);
  const base = toDevice(d);
  const list = positions.length ? positions : d.lastPosition ? [d.lastPosition] : [];
  return { ...base, phone: d.phone, contact: d.contact, groupId: d.groupId, category: d.category, positions: toPositions(list) };
}

/** Devices of a client's Traccar account (+ orphan vehicles of that client). */
export async function getDevicesForOwner(ownerUid: string): Promise<{ devices: Device[]; orphans: OrphanVehicleRow[] }> {
  const { items, orphans } = await scanDevices({ clientId: ownerUid }, 10);
  return { devices: items.map(toDevice), orphans: orphans.map(toOrphan) };
}
