import { z } from "zod";
import { STAFF_ROLES } from "@/lib/auth/rbac";
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "@/lib/admin-api/types";

/**
 * Form / Server Action schemas aligned on the backend DTOs (BACKOFFICE_API.md §7.4).
 * Keep these bounds in sync: reason 5–500, note 1–2000, limit 1–100.
 * The backend runs a strict whitelist (§4.6): schemas only produce documented fields.
 */
export const REASON_MIN = 5;
export const REASON_MAX = 500;

export const reason = z.string().trim().min(REASON_MIN, `Motif : ${REASON_MIN} caractères minimum`).max(REASON_MAX, `Motif : ${REASON_MAX} caractères maximum`);
export const staffRole = z.enum(STAFF_ROLES);

/** 8–128 chars [A-Za-z0-9_-] (§4.8). crypto.randomUUID() matches. */
export const idempotencyKey = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/, "Clé d'idempotence invalide");

/** Firebase UIDs: up to 128 chars; kept to a safe charset since they go into URL paths. */
export const uid = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, "Identifiant invalide");
export const deviceId = z.coerce.number().int().positive("ID device invalide");

export const clientAccessSchema = z.object({ disabled: z.boolean(), reason });

export const clientNoteSchema = z.object({ body: z.string().trim().min(1, "Note vide").max(2000, "Note : 2000 caractères maximum") });

export const subscriptionAdjustmentSchema = z
  .object({
    reason,
    planId: z.string().trim().min(1).optional(),
    status: z.enum(["trial", "active", "expired", "cancelled"]).optional(),
    endDate: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((v) => v.planId !== undefined || v.status !== undefined || v.endDate !== undefined, { message: "Modifier au moins un champ" })
  .refine((v) => !v.endDate || !v.status || !["active", "trial"].includes(v.status) || new Date(v.endDate) > new Date(), {
    message: "Un abonnement actif/essai doit avoir une date de fin future",
    path: ["endDate"],
  })
  .refine((v) => !v.endDate || v.status !== "expired" || new Date(v.endDate) < new Date(), {
    message: "Un abonnement expiré doit avoir une date de fin passée",
    path: ["endDate"],
  });

export const updateDeviceSchema = z
  .object({
    reason,
    name: z.string().trim().min(1).optional(),
    uniqueId: z.string().trim().min(1).optional(),
    groupId: z.number().int().optional(),
    phone: z.string().optional(),
    model: z.string().optional(),
    contact: z.string().optional(),
    category: z.string().optional(),
  })
  .strict()
  .refine(({ reason: _r, ...rest }) => Object.values(rest).some((v) => v !== undefined), { message: "Aucun champ à modifier" });

export const deviceDisabledSchema = z.object({ disabled: z.boolean(), reason });

export const linkDeviceSchema = z.object({ vehicleId: z.string().trim().min(1), ownerId: uid, reason });

export const grantStaffSchema = z.object({ email: z.email("E-mail invalide"), role: staffRole, reason });
export const updateStaffRoleSchema = z.object({ role: staffRole.nullable(), reason });

export const limit = z.coerce.number().int().min(1).max(100);

export const auditLogsQuerySchema = z.object({
  targetType: z.enum(AUDIT_TARGET_TYPES).optional().catch(undefined),
  targetId: z.string().trim().min(1).max(128).optional().catch(undefined),
  actorUid: z.string().trim().min(1).max(128).optional().catch(undefined),
  action: z.enum(AUDIT_ACTIONS).optional().catch(undefined),
  cursor: z.string().max(200).optional().catch(undefined),
  limit: limit.optional().catch(undefined),
});

/**
 * Removes keys whose value is undefined and keys equal to the initial value, so that
 * PATCH /devices/:id and subscription adjustments only send what the operator changed (§7.4).
 */
export function changedFields<T extends Record<string, unknown>>(next: T, initial: Partial<Record<keyof T, unknown>>): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(next) as [keyof T, T[keyof T]][]) {
    if (v === undefined) continue;
    if (initial[k] !== undefined && initial[k] === v) continue;
    out[k] = v;
  }
  return out;
}
