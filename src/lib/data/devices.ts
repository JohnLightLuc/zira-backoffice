import "server-only";
import { z } from "zod";
import { isDemo, hasAdminApi } from "@/lib/env";
import { demo } from "@/lib/data/demo-store";
import { adminApi, deviceSchema, deviceStatsSchema, pageSchema, positionSchema } from "@/lib/admin-api";
import { minutesSince } from "@/lib/format";
import { newRequestId } from "@/lib/format";
import type { Device, Page, Position } from "@/lib/data/types";
import type { StaffSession } from "@/lib/auth/session";

/**
 * Traccar data is only reachable through the Zira admin API (spec §3, §7.4):
 * the browser never talks to Traccar, and this server never holds Traccar credentials.
 */
export const DEVICE_FILTERS = ["all", "silent", "never", "disabled", "inconsistent"] as const;
export type DeviceFilter = (typeof DEVICE_FILTERS)[number];

export const devicesQuerySchema = z.object({
  status: z.enum(DEVICE_FILTERS).catch("all").default("all"),
  q: z.string().trim().max(80).optional().default(""),
  staleMinutes: z.coerce.number().int().min(5).max(1440).catch(30).default(30),
  cursor: z.string().max(400).optional(),
  device: z.string().max(40).optional(),
});
export type DevicesQuery = z.infer<typeof devicesQuerySchema>;

export function matchesFilter(d: Device, f: DeviceFilter, staleMinutes: number, now = Date.now()): boolean {
  const age = minutesSince(d.lastUpdate, now);
  switch (f) {
    case "silent": return !d.disabled && age != null && age > staleMinutes;
    case "never": return d.lastUpdate == null;
    case "disabled": return d.disabled;
    case "inconsistent": return d.link === "missing_in_traccar" || d.link === "unlinked";
    default: return true;
  }
}

export type DeviceSource = "demo" | "api" | "not_connected";

export async function getDevicesPage(q: DevicesQuery, staff: StaffSession): Promise<Page<Device> & { source: DeviceSource }> {
  if (isDemo()) {
    const term = q.q.toLowerCase();
    const items = demo.devices
      .filter((d) => matchesFilter(d, q.status, q.staleMinutes))
      .filter((d) => !term || [d.name, d.id, d.uniqueId, d.vehiclePlate, d.ownerName].some((v) => v?.toLowerCase().includes(term)));
    return { items, nextCursor: null, hasMore: false, source: "demo" };
  }
  if (!hasAdminApi()) return { items: [], nextCursor: null, hasMore: false, source: "not_connected" };
  const params = new URLSearchParams({ status: q.status, staleMinutes: String(q.staleMinutes) });
  if (q.q) params.set("q", q.q);
  if (q.cursor) params.set("cursor", q.cursor);
  const page = await adminApi(`/admin/v1/devices?${params}`, { schema: pageSchema(deviceSchema), staff, requestId: newRequestId() });
  return { ...page, source: "api" };
}

export async function getDeviceCounts(staleMinutes: number, staff: StaffSession) {
  if (isDemo()) {
    const all = demo.devices;
    const count = (f: DeviceFilter) => all.filter((d) => matchesFilter(d, f, staleMinutes)).length;
    const online = all.filter((d) => !d.disabled && (minutesSince(d.lastUpdate) ?? Infinity) <= staleMinutes).length;
    return { online, total: all.length, silent: count("silent"), neverSeen: count("never"), disabled: count("disabled"), inconsistent: count("inconsistent") };
  }
  if (!hasAdminApi()) return null;
  const s = await adminApi(`/admin/v1/devices/stats?staleMinutes=${staleMinutes}`, { schema: deviceStatsSchema, staff, requestId: newRequestId() });
  return { ...s, disabled: null as number | null };
}

export async function getDevice(id: string, staff: StaffSession): Promise<(Device & { positions: Position[] }) | null> {
  if (isDemo()) {
    const d = demo.devices.find((x) => x.id === id);
    return d ? { ...d } : null;
  }
  if (!hasAdminApi()) return null;
  const requestId = newRequestId();
  const to = new Date();
  const from = new Date(to.getTime() - 24 * 3600 * 1000); // bounded window (spec §11)
  const [device, positions] = await Promise.all([
    adminApi(`/admin/v1/devices/${encodeURIComponent(id)}`, { schema: deviceSchema, staff, requestId }),
    adminApi(`/admin/v1/devices/${encodeURIComponent(id)}/positions?from=${from.toISOString()}&to=${to.toISOString()}`, { schema: pageSchema(positionSchema), staff, requestId }),
  ]);
  return { ...device, positions: positions.items.slice(0, 20) };
}

export async function getDevicesForOwner(ownerUid: string, staff: StaffSession): Promise<Device[]> {
  if (isDemo()) return demo.devices.filter((d) => d.ownerUid === ownerUid);
  if (!hasAdminApi()) throw new Error("ADMIN_API_NOT_CONFIGURED");
  const page = await adminApi(`/admin/v1/devices?clientId=${encodeURIComponent(ownerUid)}`, { schema: pageSchema(deviceSchema), staff, requestId: newRequestId() });
  return page.items;
}
