"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { assertPermission } from "@/lib/auth/session";
import { ForbiddenError, type Permission } from "@/lib/auth/rbac";
import { adminApi, AdminApiError } from "@/lib/admin-api/client";
import { errorKind } from "@/lib/admin-api/core";
import {
  clientAccessSchema, clientNoteSchema, deviceDisabledSchema, deviceId as deviceIdSchema, grantStaffSchema, idempotencyKey as keySchema,
  linkDeviceSchema, subscriptionAdjustmentSchema, uid as uidSchema, updateDeviceSchema, updateStaffRoleSchema,
} from "@/lib/admin-api/schemas";
import { invalidateDeviceCache } from "@/lib/data/devices";
import type {
  ClientAccessResult, ClientNote, DeviceLinkResult, DeviceMutationResult, StaffMember, StaffUpdateResult, SubscriptionAdjustmentResult,
} from "@/lib/admin-api/types";

/**
 * Sensitive mutations (BACKOFFICE_API.md §4.7, §7.5). Each one:
 *  1. validates its input with the schemas aligned on the backend DTOs;
 *  2. checks the role for a clear message (comfort only — the backend re-checks and answers 403);
 *  3. calls /admin/v1 with the operator's ID token and the dialog's Idempotency-Key;
 *  4. lets the backend audit success AND failure (no duplicate entry here);
 *  5. revalidates the pages showing the target and its history.
 * A 401 (revoked session) redirects to /login from inside the action.
 */
export type ActionResult<T = unknown> =
  | { ok: true; message: string; requestId: string | null; changed?: boolean; data: T }
  | { ok: false; status: number; message: string; requestId: string | null; fieldErrors?: Record<string, string[]> };

const NO_CHANGE = "Aucun changement : l'état demandé était déjà en place (aucune entrée d'audit).";

function invalid(error: z.ZodError): ActionResult<never> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    // Paths come from withKey({ input, idempotencyKey }): report fields by their own name.
    const path = issue.path[0] === "input" ? issue.path.slice(1) : issue.path;
    const k = path.join(".") || "_";
    (fieldErrors[k] ??= []).push(issue.message);
  }
  return { ok: false, status: 400, message: error.issues[0]?.message ?? "Formulaire invalide", requestId: null, fieldErrors };
}

function failure(e: unknown): ActionResult<never> {
  unstable_rethrow(e); // redirect() on 401 must propagate
  if (e instanceof ForbiddenError) return { ok: false, status: 403, message: "Votre rôle ne permet pas cette action.", requestId: null };
  if (e instanceof AdminApiError) {
    const prefix: Partial<Record<ReturnType<typeof errorKind>, string>> = {
      forbidden: "Accès refusé : ",
      not_found: "Introuvable : ",
      conflict: "Conflit : ",
      traccar: "GPS indisponible : ",
      rate_limit: "",
    };
    const msg = e.status === 503 && !e.requestId ? "Action indisponible : l'API d'administration n'est pas configurée (ADMIN_API_URL)." : `${prefix[errorKind(e.status)] ?? ""}${e.message}`;
    return { ok: false, status: e.status, message: msg, requestId: e.requestId };
  }
  console.error("[admin-action] unexpected error", e);
  return { ok: false, status: 500, message: "Échec inattendu. Réessayez ou contactez l'équipe technique.", requestId: null };
}

async function run<T>(permission: Permission, call: () => Promise<T>, done: (data: T) => { message: string; changed?: boolean; paths: string[] }): Promise<ActionResult<T>> {
  try {
    await assertPermission(permission);
    const data = await call();
    const { message, changed, paths } = done(data);
    for (const p of paths) revalidatePath(p);
    return { ok: true, message: changed === false ? NO_CHANGE : message, changed, requestId: null, data };
  } catch (e) {
    return failure(e);
  }
}

const withKey = <S extends z.ZodType>(schema: S) => z.object({ input: schema, idempotencyKey: keySchema });

// ---------------------------------------------------------------- clients
export async function setClientAccess(input: { uid: string; disabled: boolean; reason: string; idempotencyKey: string }): Promise<ActionResult<ClientAccessResult>> {
  const id = uidSchema.safeParse(input.uid);
  if (!id.success) return invalid(id.error);
  const p = withKey(clientAccessSchema).safeParse({ input: { disabled: input.disabled, reason: input.reason }, idempotencyKey: input.idempotencyKey });
  if (!p.success) return invalid(p.error);
  return run("clients:suspend", () => adminApi.setClientAccess(id.data, p.data.input.disabled, p.data.input.reason, p.data.idempotencyKey), (d) => ({
    changed: d.changed,
    message: d.disabled ? "Compte suspendu : les sessions du client sont révoquées." : "Compte réactivé.",
    paths: [`/clients/${id.data}`, "/clients", "/staff", "/audit"],
  }));
}

export async function addClientNote(input: { uid: string; body: string; idempotencyKey: string }): Promise<ActionResult<ClientNote>> {
  const id = uidSchema.safeParse(input.uid);
  if (!id.success) return invalid(id.error);
  const p = withKey(clientNoteSchema).safeParse({ input: { body: input.body }, idempotencyKey: input.idempotencyKey });
  if (!p.success) return invalid(p.error);
  return run("clients:note", () => adminApi.addClientNote(id.data, p.data.input.body, p.data.idempotencyKey), () => ({
    message: "Note ajoutée (non modifiable).",
    paths: [`/clients/${id.data}`],
  }));
}

// ---------------------------------------------------------------- subscriptions
export async function adjustSubscription(input: { uid: string; reason: string; planId?: string; status?: string; endDate?: string; idempotencyKey: string }): Promise<ActionResult<SubscriptionAdjustmentResult>> {
  const id = uidSchema.safeParse(input.uid);
  if (!id.success) return invalid(id.error);
  const { uid: _u, idempotencyKey, ...fields } = input;
  const p = withKey(subscriptionAdjustmentSchema).safeParse({ input: fields, idempotencyKey });
  if (!p.success) return invalid(p.error);
  return run("subscriptions:adjust", () => adminApi.adjustSubscription(id.data, p.data.input, p.data.idempotencyKey), () => ({
    message: "Abonnement ajusté.",
    paths: [`/clients/${id.data}`, "/subscriptions", "/clients"],
  }));
}

// ---------------------------------------------------------------- devices
export async function setDeviceDisabled(input: { deviceId: string | number; ownerUid?: string | null; disabled: boolean; reason: string; idempotencyKey: string }): Promise<ActionResult<DeviceMutationResult>> {
  const id = deviceIdSchema.safeParse(input.deviceId);
  if (!id.success) return invalid(id.error);
  const p = withKey(deviceDisabledSchema).safeParse({ input: { disabled: input.disabled, reason: input.reason }, idempotencyKey: input.idempotencyKey });
  if (!p.success) return invalid(p.error);
  return run("devices:write", () => adminApi.setDeviceDisabled(id.data, p.data.input.disabled, p.data.input.reason, p.data.idempotencyKey), (d) => {
    invalidateDeviceCache();
    return {
      changed: d.changed,
      message: d.device.disabled ? `Device ${d.deviceId} désactivé dans Traccar.` : `Device ${d.deviceId} réactivé dans Traccar.`,
      paths: ["/devices", ...(input.ownerUid ? [`/clients/${input.ownerUid}`] : [])],
    };
  });
}

export async function updateDevice(input: { deviceId: string | number; ownerUid?: string | null; idempotencyKey: string; fields: Record<string, unknown> }): Promise<ActionResult<DeviceMutationResult>> {
  const id = deviceIdSchema.safeParse(input.deviceId);
  if (!id.success) return invalid(id.error);
  const p = withKey(updateDeviceSchema).safeParse({ input: input.fields, idempotencyKey: input.idempotencyKey });
  if (!p.success) return invalid(p.error);
  return run("devices:write", () => adminApi.updateDevice(id.data, p.data.input, p.data.idempotencyKey), (d) => {
    invalidateDeviceCache();
    return { changed: d.changed, message: `Device ${id.data} mis à jour.`, paths: ["/devices", ...(input.ownerUid ? [`/clients/${input.ownerUid}`] : [])] };
  });
}

export async function linkDevice(input: { deviceId: string | number; vehicleId: string; ownerId: string; reason: string; idempotencyKey: string }): Promise<ActionResult<DeviceLinkResult>> {
  const id = deviceIdSchema.safeParse(input.deviceId);
  if (!id.success) return invalid(id.error);
  const p = withKey(linkDeviceSchema).safeParse({ input: { vehicleId: input.vehicleId, ownerId: input.ownerId, reason: input.reason }, idempotencyKey: input.idempotencyKey });
  if (!p.success) return invalid(p.error);
  return run("devices:write", () => adminApi.linkDevice(id.data, p.data.input, p.data.idempotencyKey), (d) => {
    invalidateDeviceCache();
    return { changed: d.changed, message: `Device ${d.deviceId} rattaché au véhicule ${d.vehicleId}.`, paths: ["/devices", `/clients/${d.ownerId}`] };
  });
}

// ---------------------------------------------------------------- staff (super_admin)
export async function grantStaff(input: { email: string; role: string; reason: string; idempotencyKey: string }): Promise<ActionResult<StaffMember>> {
  const p = withKey(grantStaffSchema).safeParse({ input: { email: input.email, role: input.role, reason: input.reason }, idempotencyKey: input.idempotencyKey });
  if (!p.success) return invalid(p.error);
  return run("staff:manage", () => adminApi.grantStaff(p.data.input, p.data.idempotencyKey), (m) => ({
    message: `Accès ${m.role} accordé à ${m.email ?? m.uid}.${m.mfaEnrolled ? "" : " Attention : aucun second facteur enregistré."}`,
    paths: ["/staff"],
  }));
}

export async function updateStaffRole(input: { uid: string; role: string | null; reason: string; idempotencyKey: string }): Promise<ActionResult<StaffUpdateResult>> {
  const id = uidSchema.safeParse(input.uid);
  if (!id.success) return invalid(id.error);
  const p = withKey(updateStaffRoleSchema).safeParse({ input: { role: input.role, reason: input.reason }, idempotencyKey: input.idempotencyKey });
  if (!p.success) return invalid(p.error);
  return run("staff:manage", () => adminApi.updateStaffRole(id.data, p.data.input.role, p.data.input.reason, p.data.idempotencyKey), (r) => ({
    changed: r.changed,
    message: r.member.role ? `Rôle changé en ${r.member.role} : la personne devra se reconnecter.` : "Accès staff retiré : sessions révoquées.",
    paths: ["/staff"],
  }));
}
