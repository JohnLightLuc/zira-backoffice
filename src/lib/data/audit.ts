import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebase/admin";
import { isDemo } from "@/lib/env";
import { demo } from "@/lib/data/demo-store";
import { auditValue } from "@/lib/redact";
import type { AuditEntry } from "@/lib/data/types";
import type { StaffSession } from "@/lib/auth/session";

/**
 * Append-only audit log (spec §5). Written server-side with Admin SDK.
 * Production hardening: Firestore rules deny all client access to admin_audit_logs,
 * and the service account used here should only have create (no update/delete) —
 * or mirror entries to a Cloud Logging sink with a retention lock.
 */
const COLLECTION = "admin_audit_logs";

export interface AuditInput {
  staff: StaffSession;
  action: string;
  targetType: "client" | "subscription" | "device" | "document";
  targetId: string;
  ownerUid: string | null; // client the target belongs to, to show it on the client page
  result: "success" | "failure" | "read";
  requestId: string;
  reason?: string;
  change?: { field: string; before: unknown; after: unknown };
}

export async function writeAudit(input: AuditInput): Promise<void> {
  const entry = {
    action: input.action,
    actorUid: input.staff.uid,
    actorName: input.staff.name,
    role: input.staff.role,
    targetType: input.targetType,
    targetId: input.targetId,
    ownerUid: input.ownerUid,
    result: input.result,
    requestId: input.requestId,
    reason: input.reason?.slice(0, 500),
    change: input.change
      ? { field: input.change.field, before: auditValue(input.change.field, input.change.before), after: auditValue(input.change.field, input.change.after) }
      : undefined,
  };
  if (isDemo()) {
    demo.pushAudit(input.ownerUid, { id: input.requestId, at: new Date().toISOString(), ...entry, reason: entry.reason, change: entry.change });
    return;
  }
  await db().collection(COLLECTION).add({ ...stripUndefined(entry), at: FieldValue.serverTimestamp() });
}

export async function listAuditForOwner(ownerUid: string, limit = 20): Promise<AuditEntry[]> {
  if (isDemo()) return demo.auditFor(ownerUid).slice(0, limit);
  // Index: admin_audit_logs (ownerUid ASC, at DESC) — see firestore.indexes.json
  const snap = await db().collection(COLLECTION).where("ownerUid", "==", ownerUid).orderBy("at", "desc").limit(limit).get();
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      action: x.action,
      actorUid: x.actorUid,
      actorName: x.actorName,
      role: x.role,
      targetType: x.targetType,
      targetId: x.targetId,
      at: x.at?.toDate?.().toISOString() ?? new Date(0).toISOString(),
      result: x.result,
      requestId: x.requestId,
      reason: x.reason,
      change: x.change,
    } satisfies AuditEntry;
  });
}

function stripUndefined<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}
