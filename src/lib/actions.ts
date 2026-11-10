"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/auth/rbac";
import { isDemo } from "@/lib/env";
import { demo } from "@/lib/data/demo-store";
import { writeAudit } from "@/lib/data/audit";
import { adminApi, AdminApiError, okSchema } from "@/lib/admin-api";
import { newRequestId } from "@/lib/format";

/**
 * Sensitive mutations (spec §8, §9). Each one:
 *  1. validates its input (zod), 2. re-checks the staff role server-side,
 *  3. goes through the Zira admin API (which re-checks again and owns the business rules),
 *  4. writes an audit entry for success AND failure, with the operator's reason.
 * Never triggered by a GET; idempotency key supplied by the dialog for safe retries.
 */
export interface ActionResult {
  ok: boolean;
  message: string;
  requestId: string;
}

const reason = z.string().trim().min(10, "Motif : 10 caractères minimum").max(500);
const idempotencyKey = z.string().uuid();

const accessSchema = z.object({ uid: z.string().min(6).max(128), disabled: z.boolean(), reason, idempotencyKey });

export async function setClientAccess(input: z.input<typeof accessSchema>): Promise<ActionResult> {
  const requestId = newRequestId();
  const parsed = accessSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Requête invalide", requestId };
  const { uid, disabled } = parsed.data;

  let staff;
  try {
    staff = await assertPermission("clients:suspend");
  } catch (e) {
    return { ok: false, message: e instanceof ForbiddenError ? "Votre rôle ne permet pas cette action." : "Session expirée.", requestId };
  }

  const action = disabled ? "Compte suspendu" : "Compte réactivé";
  try {
    if (isDemo()) {
      const c = demo.clients.find((x) => x.uid === uid);
      if (!c) throw new AdminApiError(404, "NOT_FOUND", "Client introuvable", requestId);
      c.authDisabled = disabled;
    } else {
      await adminApi(`/admin/v1/clients/${encodeURIComponent(uid)}/access`, {
        method: "PATCH", body: { disabled, reason: parsed.data.reason }, schema: okSchema, staff, requestId, idempotencyKey: parsed.data.idempotencyKey,
      });
    }
    await writeAudit({ staff, action, targetType: "client", targetId: uid, ownerUid: uid, result: "success", requestId, reason: parsed.data.reason, change: { field: "disabled", before: !disabled, after: disabled } });
    revalidatePath(`/clients/${uid}`);
    revalidatePath("/clients");
    return { ok: true, message: `${action}. Entrée d'audit créée.`, requestId };
  } catch (e) {
    await writeAudit({ staff, action, targetType: "client", targetId: uid, ownerUid: uid, result: "failure", requestId, reason: parsed.data.reason }).catch(() => {});
    return { ok: false, message: errorMessage(e), requestId };
  }
}

const disableSchema = z.object({ deviceId: z.string().min(1).max(40), ownerUid: z.string().max(128).nullable(), reason, idempotencyKey });

export async function disableDevice(input: z.input<typeof disableSchema>): Promise<ActionResult> {
  const requestId = newRequestId();
  const parsed = disableSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Requête invalide", requestId };
  const { deviceId, ownerUid } = parsed.data;

  let staff;
  try {
    staff = await assertPermission("devices:write");
  } catch (e) {
    return { ok: false, message: e instanceof ForbiddenError ? "Votre rôle ne permet pas cette action." : "Session expirée.", requestId };
  }

  const action = `Désactivation device ${deviceId}`;
  try {
    if (isDemo()) {
      const d = demo.devices.find((x) => x.id === deviceId);
      if (!d) throw new AdminApiError(404, "NOT_FOUND", "Device introuvable", requestId);
      d.disabled = true;
    } else {
      await adminApi(`/admin/v1/devices/${encodeURIComponent(deviceId)}/disable`, {
        method: "POST", body: { reason: parsed.data.reason }, schema: okSchema, staff, requestId, idempotencyKey: parsed.data.idempotencyKey,
      });
    }
    await writeAudit({ staff, action, targetType: "device", targetId: deviceId, ownerUid, result: "success", requestId, reason: parsed.data.reason, change: { field: "disabled", before: false, after: true } });
    revalidatePath("/devices");
    if (ownerUid) revalidatePath(`/clients/${ownerUid}`);
    return { ok: true, message: `Device ${deviceId} désactivé dans Traccar. Entrée d'audit créée.`, requestId };
  } catch (e) {
    await writeAudit({ staff, action, targetType: "device", targetId: deviceId, ownerUid, result: "failure", requestId, reason: parsed.data.reason }).catch(() => {});
    return { ok: false, message: errorMessage(e), requestId };
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof AdminApiError) {
    if (e.code === "ADMIN_API_NOT_CONFIGURED") return "Action indisponible : l'API d'administration Zira n'est pas encore branchée (prérequis backend).";
    return `Échec côté serveur (${e.code}) : ${e.message}`;
  }
  return "Échec inattendu. Réessayez ou contactez l'équipe technique.";
}
