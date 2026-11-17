import { demo, DEMO_PLANS, type DemoTraccarDevice } from "@/lib/data/demo-store";
import { isStaffRole, type StaffRole } from "@/lib/auth/rbac";
import type {
  AdminDeviceDetail, AdminDeviceItem, AdminDeviceList, AuditAction, AuditLogEntry, AuditTargetType, ClientNote, DeviceEditableFields,
  DeviceIssue, HealthReport, OrphanVehicle, StaffMember, SubscriptionState, TraccarPosition,
} from "@/lib/admin-api/types";

/**
 * In-memory implementation of the /admin/v1 contract (BACKOFFICE_API.md §3–§5), plugged in as the
 * `fetch` of the admin transport when ZIRA_DEMO_MODE=true. It reproduces the rules the UI must cope
 * with — envelope, role matrix, strict whitelist, reason 5–500, `changed: false` without audit,
 * Idempotency-Key replay/409/422, cursor pagination, 404/409 cases — so that demo mode and tests
 * exercise the same code path as production. Never used outside demo mode or tests.
 *
 * Demo bearer token format: `demo:<uid>:<role>`.
 */
type Role = StaffRole;
const ALL: Role[] = ["super_admin", "support", "billing", "viewer"];
const WRITE_DEVICES: Role[] = ["super_admin", "support"];

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

interface Ctx {
  method: string;
  path: string;
  query: URLSearchParams;
  body: Record<string, unknown>;
  staff: { uid: string; role: Role; email: string | null };
  requestId: string;
}

let seq = 100;
const nextId = (p: string) => `${p}${++seq}`;

// ---------------------------------------------------------------- idempotency (staff + method + path + key)
const idem = new Map<string, { bodyHash: string; status: number; payload: unknown } | "pending">();

export function resetDemoIdempotency() {
  idem.clear();
}

export async function demoAdminFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const headers = new Headers(init.headers);
  const method = (init.method ?? "GET").toUpperCase();
  const clientRid = headers.get("x-request-id");
  const requestId = clientRid && /^[\w-]{8,64}$/.test(clientRid) ? clientRid : crypto.randomUUID();

  // ---- StaffAuthGuard
  const auth = headers.get("authorization") ?? "";
  const m = /^Bearer demo:([^:]+):([A-Za-z_]+)$/.exec(auth);
  if (!m) return envelope(401, "Token d'authentification invalide ou expiré", null);
  const role = m[2];
  if (!isStaffRole(role)) return envelope(403, "Accès réservé au personnel Zira", null);
  const uid = m[1]!;
  const staff = { uid, role, email: demo.staff.find((s) => s.uid === uid)?.email ?? null };

  const path = url.pathname.replace(/^\/admin\/v1/, "") || "/";
  let body: Record<string, unknown> = {};
  if (init.body != null) {
    try { body = JSON.parse(String(init.body)); } catch { return envelope(400, "Corps JSON invalide", null, requestId); }
  }

  const key = headers.get("idempotency-key");
  let idemKey: string | null = null;
  if (key !== null && method !== "GET") {
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) return envelope(400, "Idempotency-Key invalide", null, requestId);
    idemKey = `${uid}|${method}|${path}|${key}`;
    const prev = idem.get(idemKey);
    const hash = JSON.stringify(body);
    if (prev === "pending") return envelope(409, "Requête identique déjà en cours", null, requestId);
    if (prev) {
      if (prev.bodyHash !== hash) return envelope(422, "Idempotency-Key déjà utilisée avec un corps différent", null, requestId);
      return envelope(prev.status, "Succès", prev.payload, requestId);
    }
    idem.set(idemKey, "pending");
  }

  try {
    const { status, data } = route({ method, path, query: url.searchParams, body, staff, requestId });
    if (idemKey) idem.set(idemKey, { bodyHash: JSON.stringify(body), status, payload: data });
    return envelope(status, "Succès", data, requestId);
  } catch (e) {
    if (idemKey) idem.delete(idemKey); // failed mutation releases the key
    if (e instanceof HttpError) return envelope(e.status, e.message, null, requestId);
    return envelope(500, "Erreur interne", null, requestId);
  }
}

function envelope(status: number, message: string, data: unknown, requestId?: string): Response {
  const ok = status < 400;
  const h = new Headers({ "content-type": "application/json" });
  if (requestId) h.set("x-request-id", requestId);
  return new Response(JSON.stringify({ success: ok, message: ok ? "Succès" : message, data: ok ? data : null }), { status, headers: h });
}

// ---------------------------------------------------------------- router
function route(c: Ctx): { status: number; data: unknown } {
  const { method: M, path: p } = c;
  let r: RegExpExecArray | null;
  const ok = (data: unknown, status = 200) => ({ status, data });

  if (M === "GET" && p === "/health") return guard(c, ALL), ok(health());
  if (M === "GET" && p === "/devices") return guard(c, ALL), ok(listDevices(c));
  if ((r = /^\/devices\/([^/]+)$/.exec(p))) {
    if (M === "GET") return guard(c, ALL), ok(deviceDetail(intParam(r[1]!)));
    if (M === "PATCH") return guard(c, WRITE_DEVICES), ok(updateDevice(c, intParam(r[1]!)));
  }
  if (M === "GET" && (r = /^\/devices\/([^/]+)\/positions$/.exec(p))) return guard(c, ALL), ok(positions(c, intParam(r[1]!)));
  if (M === "POST" && (r = /^\/devices\/([^/]+)\/(disable|enable)$/.exec(p))) return guard(c, WRITE_DEVICES), ok(setDisabled(c, intParam(r[1]!), r[2] === "disable"));
  if (M === "POST" && (r = /^\/devices\/([^/]+)\/link$/.exec(p))) return guard(c, WRITE_DEVICES), ok(link(c, intParam(r[1]!)));
  if (M === "PATCH" && (r = /^\/clients\/([^/]+)\/access$/.exec(p))) return guard(c, ["super_admin", "support"]), ok(clientAccess(c, decodeURIComponent(r[1]!)));
  if ((r = /^\/clients\/([^/]+)\/notes$/.exec(p))) {
    if (M === "GET") return guard(c, ["super_admin", "support", "billing"]), ok(listNotes(c, decodeURIComponent(r[1]!)));
    if (M === "POST") return guard(c, ["super_admin", "support"]), ok(addNote(c, decodeURIComponent(r[1]!)), 201);
  }
  if (M === "POST" && (r = /^\/subscriptions\/([^/]+)\/adjustments$/.exec(p))) return guard(c, ["super_admin", "billing"]), ok(adjust(c, decodeURIComponent(r[1]!)), 201);
  if (M === "GET" && p === "/audit-logs") return guard(c, ["super_admin", "support", "billing"]), ok(listAudit(c));
  if (p === "/staff") {
    if (M === "GET") return guard(c, ["super_admin"]), ok(demo.staff.filter((s) => s.role).map(publicStaff));
    if (M === "POST") return guard(c, ["super_admin"]), ok(grantStaff(c), 201);
  }
  if (M === "PATCH" && (r = /^\/staff\/([^/]+)$/.exec(p))) return guard(c, ["super_admin"]), ok(updateStaff(c, decodeURIComponent(r[1]!)));
  throw new HttpError(404, `Cannot ${M} /admin/v1${p}`);
}

function guard(c: Ctx, roles: Role[]) {
  if (!roles.includes(c.staff.role)) throw new HttpError(403, "Rôle insuffisant pour cette action");
}

// ---------------------------------------------------------------- validation helpers (whitelist: forbidNonWhitelisted)
function whitelist(obj: Record<string, unknown> | URLSearchParams, allowed: string[]) {
  const keys = obj instanceof URLSearchParams ? [...obj.keys()] : Object.keys(obj);
  const extra = keys.filter((k) => !allowed.includes(k));
  if (extra.length) throw new HttpError(400, extra.map((k) => `property ${k} should not exist`).join(", "));
}
function reasonOf(body: Record<string, unknown>): string {
  const r = body.reason;
  if (typeof r !== "string" || r.trim().length < 5 || r.length > 500) throw new HttpError(400, "reason doit contenir entre 5 et 500 caractères");
  return r.trim();
}
function intParam(v: string): number {
  if (!/^\d+$/.test(v)) throw new HttpError(400, "Validation failed (numeric string is expected)");
  return Number(v);
}
function bool(q: URLSearchParams, k: string): boolean | undefined {
  const v = q.get(k);
  if (v === null) return undefined;
  if (v !== "true" && v !== "false") throw new HttpError(400, `${k} doit être un booléen`);
  return v === "true";
}
function isoParam(q: URLSearchParams, k: string, required = false): string | undefined {
  const v = q.get(k);
  if (v === null) { if (required) throw new HttpError(400, `${k} doit être une date ISO 8601`); return undefined; }
  if (Number.isNaN(Date.parse(v)) || !/^\d{4}-\d{2}-\d{2}T/.test(v)) throw new HttpError(400, `${k} doit être une date ISO 8601`);
  return v;
}
function limitOf(q: URLSearchParams): number {
  const v = q.get("limit");
  if (v === null) return 50;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 100) throw new HttpError(400, "limit doit être compris entre 1 et 100");
  return n;
}

// ---------------------------------------------------------------- audit
function audit(c: Ctx, action: AuditAction, targetType: AuditTargetType, targetId: string, reason: string | null, before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  demo.auditLogs.unshift({
    id: nextId("a"), actorUid: c.staff.uid, actorEmail: c.staff.email, actorRole: c.staff.role, requestId: c.requestId,
    action, targetType, targetId, result: "success", reason, before, after, error: null, createdAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------- health
function health(): HealthReport {
  return {
    status: "degraded",
    checkedAt: new Date().toISOString(),
    checks: {
      firestore: { status: "up", latencyMs: 42 },
      redis: { status: "up", latencyMs: 3 },
      traccar: { status: "down", latencyMs: 5000, error: "Délai dépassé (démonstration)" },
    },
  };
}

// ---------------------------------------------------------------- devices
function ownerOfDevice(d: DemoTraccarDevice) {
  return demo.vehicles.filter((v) => v.deviceId === d.id);
}

function toItem(d: DemoTraccarDevice, detail = false): AdminDeviceItem {
  const linked = ownerOfDevice(d);
  const v = linked[0] ?? null;
  const client = v ? demo.clients.find((x) => x.uid === v.ownerId) ?? null : null;
  const issues: DeviceIssue[] = [];
  if (!linked.length) issues.push("NO_VEHICLE");
  if (linked.length > 1) issues.push("MULTIPLE_VEHICLES");
  if (v?.uniqueId && v.uniqueId !== d.uniqueId) issues.push("UNIQUE_ID_MISMATCH");
  if (v && !client) issues.push("OWNER_NOT_FOUND");
  if (client && !client.traccarUserId) issues.push("OWNER_NOT_LINKED_TRACCAR");
  if (detail && client?.traccarUserId && !demo.traccarPermissions.get(client.uid)?.has(d.id)) issues.push("OWNER_NO_TRACCAR_PERMISSION");
  const age = d.lastUpdate ? Math.round((Date.now() - Date.parse(d.lastUpdate)) / 1000) : null;
  return {
    id: d.id, name: d.name, uniqueId: d.uniqueId, model: d.model, category: d.category, disabled: d.disabled,
    status: d.lastUpdate == null ? "unknown" : age! < 600 ? "online" : "offline",
    lastUpdate: d.lastUpdate, lastSeenAgeSeconds: age,
    vehicle: v ? { id: v.id, label: v.label, plate: v.plate, ownerId: v.ownerId, uniqueId: v.uniqueId } : null,
    client: client ? { id: client.uid, email: client.email, name: client.name } : null,
    issues,
  };
}

function findDevice(id: number) {
  const d = demo.traccarDevices.find((x) => x.id === id);
  if (!d) throw new HttpError(404, "Device introuvable");
  return d;
}

function listDevices(c: Ctx): AdminDeviceList {
  const q = c.query;
  whitelist(q, ["clientId", "status", "staleBefore", "neverSeen", "disabled", "unlinked", "cursor", "limit"]);
  const status = q.get("status");
  if (status !== null && !["online", "offline", "unknown"].includes(status)) throw new HttpError(400, "status doit être online, offline ou unknown");
  const staleBefore = isoParam(q, "staleBefore");
  const neverSeen = bool(q, "neverSeen"), disabled = bool(q, "disabled"), unlinked = bool(q, "unlinked");
  const limit = limitOf(q);
  const cursor = q.get("cursor");
  if (cursor !== null && !/^\d+$/.test(cursor)) throw new HttpError(400, "Curseur invalide");
  const clientId = q.get("clientId");
  let visible: Set<number> | null = null;
  if (clientId) {
    const client = demo.clients.find((x) => x.uid === clientId);
    if (!client) throw new HttpError(404, "Client introuvable");
    visible = demo.traccarPermissions.get(clientId) ?? new Set();
  }

  const all = demo.traccarDevices
    .filter((d) => !visible || visible.has(d.id))
    .map((d) => toItem(d))
    .filter((d) => status === null || d.status === status)
    .filter((d) => !staleBefore || d.lastUpdate == null || d.lastUpdate < staleBefore)
    .filter((d) => neverSeen === undefined || (d.lastUpdate == null) === neverSeen)
    .filter((d) => disabled === undefined || d.disabled === disabled)
    .filter((d) => unlinked === undefined || (d.vehicle == null) === unlinked)
    .sort((a, b) => a.id - b.id);

  const start = cursor ? all.findIndex((d) => d.id > Number(cursor)) : 0;
  const slice = start < 0 ? [] : all.slice(start, start + limit);
  const hasMore = start >= 0 && start + limit < all.length;
  const page: AdminDeviceList = { items: slice, hasMore, nextCursor: hasMore ? String(slice[slice.length - 1]!.id) : null };

  if (!cursor) {
    const ids = new Set(demo.traccarDevices.map((d) => d.id));
    const orphans: OrphanVehicle[] = demo.vehicles
      .filter((v) => v.deviceId != null && (!clientId || v.ownerId === clientId))
      .flatMap((v): OrphanVehicle[] => {
        const vehicle = { id: v.id, label: v.label, plate: v.plate, ownerId: v.ownerId, deviceId: v.deviceId, uniqueId: v.uniqueId };
        if (!ids.has(v.deviceId!)) return [{ vehicle, reason: "DEVICE_NOT_FOUND" }];
        if (visible && !visible.has(v.deviceId!)) return [{ vehicle, reason: "DEVICE_NOT_IN_CLIENT_ACCOUNT" }];
        return [];
      });
    page.orphanVehicles = orphans;
  }
  return page;
}

function toPosition(d: DemoTraccarDevice, p: DemoTraccarDevice["positions"][number], i: number): TraccarPosition {
  return {
    id: d.id * 1000 + i, deviceId: d.id, protocol: "teltonika", serverTime: p.at, deviceTime: p.at, fixTime: p.at,
    outdated: false, valid: true, latitude: p.lat, longitude: p.lon, altitude: 0, speed: Math.round((p.speedKmh / 1.852) * 100) / 100,
    course: 0, address: null, accuracy: 0, attributes: { ignition: p.speedKmh > 0 },
  };
}

function deviceDetail(id: number): AdminDeviceDetail {
  const d = findDevice(id);
  const last = d.positions[0];
  return { ...toItem(d, true), phone: d.phone, contact: d.contact, groupId: d.groupId, attributes: {}, lastPosition: last ? toPosition(d, last, 0) : null };
}

function positions(c: Ctx, id: number): TraccarPosition[] {
  whitelist(c.query, ["from", "to"]);
  const from = isoParam(c.query, "from", true)!, to = isoParam(c.query, "to", true)!;
  if (Date.parse(to) <= Date.parse(from)) throw new HttpError(400, '"to" doit être postérieur à "from"');
  if (Date.parse(to) - Date.parse(from) > 7 * 864e5) throw new HttpError(400, "Fenêtre limitée à 7 jours");
  const d = findDevice(id);
  return d.positions
    .map((p, i) => toPosition(d, p, i))
    .filter((p) => p.fixTime >= from && p.fixTime <= to)
    .sort((a, b) => a.fixTime.localeCompare(b.fixTime)); // chronological
}

function editable(d: DemoTraccarDevice): DeviceEditableFields {
  return { name: d.name, uniqueId: d.uniqueId, disabled: d.disabled, groupId: d.groupId, phone: d.phone, model: d.model, contact: d.contact, category: d.category };
}

const EDITABLE = ["name", "uniqueId", "groupId", "phone", "model", "contact", "category"] as const;

function updateDevice(c: Ctx, id: number) {
  whitelist(c.body, ["reason", ...EDITABLE]);
  const reason = reasonOf(c.body);
  const patch = Object.fromEntries(EDITABLE.filter((k) => c.body[k] !== undefined).map((k) => [k, c.body[k]]));
  if (!Object.keys(patch).length) throw new HttpError(400, "Aucun champ à modifier");
  for (const k of ["name", "uniqueId"] as const) if (k in patch && (typeof patch[k] !== "string" || !(patch[k] as string).trim())) throw new HttpError(400, `${k} ne doit pas être vide`);
  if ("groupId" in patch && !Number.isInteger(patch.groupId)) throw new HttpError(400, "groupId doit être un entier");
  const d = findDevice(id);
  const before = editable(d);
  const changed = Object.entries(patch).some(([k, v]) => before[k as keyof DeviceEditableFields] !== v);
  if (changed) {
    Object.assign(d, patch);
    if (patch.uniqueId) for (const v of ownerOfDevice(d)) v.uniqueId = d.uniqueId;
    audit(c, "device.update", "device", String(id), reason, { ...before }, { ...editable(d) });
  }
  return { deviceId: id, changed, device: editable(d) };
}

function setDisabled(c: Ctx, id: number, disabled: boolean) {
  whitelist(c.body, ["reason"]);
  const reason = reasonOf(c.body);
  const d = findDevice(id);
  const changed = d.disabled !== disabled;
  if (changed) {
    d.disabled = disabled;
    audit(c, disabled ? "device.disable" : "device.enable", "device", String(id), reason, { disabled: !disabled }, { disabled });
  }
  return { deviceId: id, changed, device: editable(d) };
}

function link(c: Ctx, id: number) {
  whitelist(c.body, ["vehicleId", "ownerId", "reason"]);
  const reason = reasonOf(c.body);
  const vehicleId = String(c.body.vehicleId ?? ""), ownerId = String(c.body.ownerId ?? "");
  if (!vehicleId || !ownerId) throw new HttpError(400, "vehicleId et ownerId sont obligatoires");
  const d = findDevice(id);
  const v = demo.vehicles.find((x) => x.id === vehicleId);
  if (!v) throw new HttpError(404, "Véhicule introuvable");
  const client = demo.clients.find((x) => x.uid === ownerId);
  if (!client) throw new HttpError(404, "Client introuvable");
  if (v.ownerId !== ownerId) throw new HttpError(400, "Le véhicule n'appartient pas à ce client");
  if (!client.traccarUserId) throw new HttpError(400, "Le client n'a pas de compte Traccar");
  if (v.deviceId != null && v.deviceId !== id) throw new HttpError(409, `Véhicule déjà rattaché au device ${v.deviceId}`);
  const other = demo.vehicles.find((x) => x.deviceId === id && x.id !== vehicleId);
  if (other) throw new HttpError(409, `Device déjà rattaché au véhicule ${other.id}`);
  const perms = demo.traccarPermissions.get(ownerId) ?? new Set<number>();
  const changed = v.deviceId !== id || v.uniqueId !== d.uniqueId || !perms.has(id);
  if (changed) {
    const before = { deviceId: v.deviceId, uniqueId: v.uniqueId };
    perms.add(id);
    demo.traccarPermissions.set(ownerId, perms);
    v.deviceId = id;
    v.uniqueId = d.uniqueId;
    audit(c, "device.link", "device", String(id), reason, before, { deviceId: id, uniqueId: d.uniqueId, vehicleId, ownerId });
  }
  return { deviceId: id, vehicleId, ownerId, changed };
}

// ---------------------------------------------------------------- clients
function clientAccess(c: Ctx, uid: string) {
  whitelist(c.body, ["disabled", "reason"]);
  const reason = reasonOf(c.body);
  if (typeof c.body.disabled !== "boolean") throw new HttpError(400, "disabled doit être un booléen");
  const disabled = c.body.disabled;
  if (uid === c.staff.uid) throw new HttpError(400, "Impossible de modifier votre propre accès");
  const member = demo.staff.find((s) => s.uid === uid && s.role);
  if (member) {
    if (c.staff.role !== "super_admin") throw new HttpError(403, "Seul un super_admin peut suspendre un compte staff");
    const changed = member.disabled !== disabled;
    if (changed) { member.disabled = disabled; audit(c, disabled ? "client.suspend" : "client.reactivate", "client", uid, reason, { disabled: !disabled }, { disabled }); }
    return { uid, disabled, changed };
  }
  const client = demo.clients.find((x) => x.uid === uid);
  if (!client) throw new HttpError(404, "Utilisateur introuvable");
  const changed = client.authDisabled !== disabled;
  if (changed) {
    client.authDisabled = disabled;
    audit(c, disabled ? "client.suspend" : "client.reactivate", "client", uid, reason, { disabled: !disabled }, { disabled });
  }
  return { uid, disabled, changed };
}

function paginateById<T extends { id: string }>(items: T[], q: URLSearchParams) {
  const limit = limitOf(q);
  const cursor = q.get("cursor");
  let start = 0;
  if (cursor) {
    const i = items.findIndex((x) => x.id === cursor);
    if (i < 0) throw new HttpError(400, "Curseur invalide");
    start = i + 1;
  }
  const slice = items.slice(start, start + limit);
  const hasMore = start + limit < items.length;
  return { items: slice, hasMore, nextCursor: hasMore ? slice[slice.length - 1]!.id : null };
}

function listNotes(c: Ctx, uid: string) {
  whitelist(c.query, ["cursor", "limit"]);
  if (!demo.clients.some((x) => x.uid === uid)) throw new HttpError(404, "Client introuvable");
  const items = demo.notes.filter((n) => n.clientId === uid).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return paginateById(items, c.query);
}

function addNote(c: Ctx, uid: string): ClientNote {
  whitelist(c.body, ["body"]);
  const body = typeof c.body.body === "string" ? c.body.body.trim() : "";
  if (body.length < 1 || body.length > 2000) throw new HttpError(400, "body doit contenir entre 1 et 2000 caractères");
  if (!demo.clients.some((x) => x.uid === uid)) throw new HttpError(404, "Client introuvable");
  const note: ClientNote = { id: nextId("n"), clientId: uid, body, authorUid: c.staff.uid, authorEmail: c.staff.email, createdAt: new Date().toISOString() };
  demo.notes.push(note);
  audit(c, "client.note.create", "client", uid, null, null, { noteId: note.id });
  return note;
}

// ---------------------------------------------------------------- subscriptions
function adjust(c: Ctx, uid: string) {
  whitelist(c.body, ["reason", "planId", "status", "endDate"]);
  const reason = reasonOf(c.body);
  const { planId, status, endDate } = c.body as { planId?: unknown; status?: unknown; endDate?: unknown };
  if (planId === undefined && status === undefined && endDate === undefined) throw new HttpError(400, "Aucun changement demandé");
  if (status !== undefined && !["trial", "active", "expired", "cancelled"].includes(String(status))) throw new HttpError(400, "status invalide");
  if (endDate !== undefined && (typeof endDate !== "string" || Number.isNaN(Date.parse(endDate)))) throw new HttpError(400, "endDate doit être une date ISO 8601");
  const client = demo.clients.find((x) => x.uid === uid);
  if (!client || client.subStatus === "free") throw new HttpError(404, "Abonnement introuvable");
  if (planId !== undefined && !DEMO_PLANS[String(planId)]) throw new HttpError(400, "Plan inconnu ou sans permissions");

  const rawStatus = client.subStatus === "expiring" ? "active" : client.subStatus;
  const before: SubscriptionState = { planId: client.plan, status: rawStatus, endDate: client.subEndDate, permissions: client.permissions ?? DEMO_PLANS[client.plan] ?? null };
  const after: SubscriptionState = {
    planId: planId !== undefined ? String(planId) : before.planId,
    status: status !== undefined ? String(status) : before.status,
    endDate: endDate !== undefined ? new Date(String(endDate)).toISOString() : before.endDate,
    permissions: planId !== undefined ? DEMO_PLANS[String(planId)]! : before.permissions,
  };
  const now = Date.now();
  const end = after.endDate ? Date.parse(after.endDate) : null;
  if (end != null && client.subStartDate && end <= Date.parse(client.subStartDate)) throw new HttpError(400, "endDate doit être postérieure à startDate");
  if ((after.status === "active" || after.status === "trial") && (end == null || end <= now)) throw new HttpError(400, "Un abonnement actif ou en essai doit avoir une date de fin future");
  if (after.status === "expired" && end != null && end > now) throw new HttpError(400, "Un abonnement expiré doit avoir une date de fin passée");

  client.plan = after.planId ?? client.plan;
  client.subEndDate = after.endDate;
  client.permissions = after.permissions;
  const st = after.status as "trial" | "active" | "expired" | "cancelled";
  client.subStatus = st === "active" && end != null && end - now < 7 * 864e5 ? "expiring" : st;
  audit(c, "subscription.adjust", "subscription", uid, reason, { ...before }, { ...after });
  return { uid, before, after };
}

// ---------------------------------------------------------------- audit logs
function listAudit(c: Ctx) {
  whitelist(c.query, ["targetType", "targetId", "actorUid", "action", "cursor", "limit"]);
  const f = (k: keyof AuditLogEntry) => c.query.get(k);
  const items = demo.auditLogs
    .filter((e) => (["targetType", "targetId", "actorUid", "action"] as const).every((k) => f(k) === null || e[k] === f(k)))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return paginateById(items, c.query);
}

// ---------------------------------------------------------------- staff
function publicStaff(s: StaffMember): StaffMember {
  const { uid, email, displayName, role, disabled, mfaEnrolled, lastSignInTime } = s;
  return { uid, email, displayName, role, disabled, mfaEnrolled, lastSignInTime };
}

function grantStaff(c: Ctx): StaffMember {
  whitelist(c.body, ["email", "role", "reason"]);
  const reason = reasonOf(c.body);
  const email = String(c.body.email ?? "").toLowerCase();
  const role = c.body.role;
  if (!isStaffRole(role)) throw new HttpError(400, "role invalide");
  if (email === c.staff.email) throw new HttpError(400, "Impossible de modifier votre propre accès");
  const existing = demo.staff.find((s) => s.email === email);
  if (existing?.role) throw new HttpError(409, "Ce compte est déjà membre du personnel (utiliser PATCH)");
  const account = existing ?? demo.plainAccounts.find((a) => a.email === email);
  if (!account) throw new HttpError(404, "Aucun compte Firebase Auth pour cet e-mail");
  const member: StaffMember = { uid: account.uid, email, displayName: account.displayName, role, disabled: false, mfaEnrolled: false, lastSignInTime: null };
  if (existing) Object.assign(existing, member); else demo.staff.push(member);
  audit(c, "staff.grant", "staff", member.uid, reason, { role: null }, { role });
  return member;
}

function updateStaff(c: Ctx, uid: string) {
  whitelist(c.body, ["role", "reason"]);
  const reason = reasonOf(c.body);
  if (!("role" in c.body)) throw new HttpError(400, "role est obligatoire");
  const role = c.body.role;
  if (role !== null && !isStaffRole(role)) throw new HttpError(400, "role invalide");
  if (uid === c.staff.uid) throw new HttpError(400, "Impossible de modifier votre propre rôle");
  const member = demo.staff.find((s) => s.uid === uid && s.role);
  if (!member) throw new HttpError(404, "Compte staff introuvable");
  const changed = member.role !== role;
  if (changed) {
    const before = member.role;
    member.role = role;
    audit(c, role === null ? "staff.revoke" : "staff.update", "staff", uid, reason, { role: before }, { role });
  }
  return { member: publicStaff(member), changed };
}
