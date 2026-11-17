import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebase/admin";
import { isDemo } from "@/lib/env";
import { demo } from "@/lib/data/demo-store";
import { adminApi } from "@/lib/admin-api/client";
import { auditValue, redact } from "@/lib/redact";
import type { AuditLogEntry, AuditLogsQuery, CursorPage } from "@/lib/admin-api/types";
import type { AuditEntry } from "@/lib/data/types";
import type { StaffSession } from "@/lib/auth/session";

/**
 * Audit trail (BACKOFFICE_API.md §5.6). Every admin mutation is audited by the backend itself
 * (success and failure, secrets masked) — this server never duplicates those entries.
 * Reads go through GET /admin/v1/audit-logs (role check, masking and pagination centralised).
 */
export const AUDIT_LABEL: Record<string, string> = {
  "client.suspend": "Compte suspendu",
  "client.reactivate": "Compte réactivé",
  "client.note.create": "Note ajoutée",
  "subscription.adjust": "Abonnement ajusté",
  "device.update": "Device modifié",
  "device.disable": "Device désactivé",
  "device.enable": "Device réactivé",
  "device.link": "Device rattaché",
  "staff.grant": "Accès staff accordé",
  "staff.update": "Rôle staff modifié",
  "staff.revoke": "Accès staff retiré",
  "client.export": "Export CSV clients",
};

/** Field-level diff between `before` and `after` (values bounded, secrets already "[REDACTED]"). */
export function diffOf(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  return keys
    .filter((k) => JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after?.[k] ?? null))
    .map((k) => ({ field: k, before: auditValue(k, before?.[k] ?? null), after: auditValue(k, after?.[k] ?? null) }));
}

export function toAuditEntry(e: AuditLogEntry): AuditEntry {
  const changes = diffOf(e.before, e.after);
  return {
    id: e.id,
    code: e.action,
    action: AUDIT_LABEL[e.action] ?? e.action,
    actorUid: e.actorUid,
    actorName: e.actorEmail ?? e.actorUid,
    role: e.actorRole,
    targetType: e.targetType,
    targetId: e.targetId,
    at: e.createdAt ?? new Date(0).toISOString(),
    result: e.result,
    requestId: e.requestId,
    reason: e.reason ?? undefined,
    error: e.error ?? undefined,
    change: changes[0],
    changes,
  };
}

export async function getAuditPage(q: AuditLogsQuery): Promise<CursorPage<AuditEntry>> {
  const page = await adminApi.auditLogs(q);
  return { ...page, items: page.items.map(toAuditEntry) };
}

/** History of a client: actions on the account and on its subscription. */
export async function getClientHistory(uid: string, limit = 20): Promise<AuditEntry[]> {
  const [client, sub] = await Promise.all([
    adminApi.auditLogs({ targetType: "client", targetId: uid, limit }),
    adminApi.auditLogs({ targetType: "subscription", targetId: uid, limit }),
  ]);
  return [...client.items, ...sub.items]
    .map(toAuditEntry)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}

/**
 * The CSV export is the only sensitive operation served by Next.js itself (no admin route).
 * It is written in the backend's audit schema so it shows up in GET /audit-logs.
 */
export async function writeExportAudit(staff: StaffSession, requestId: string, rows: number, filters: Record<string, unknown>): Promise<void> {
  const entry = {
    actorUid: staff.uid,
    actorEmail: staff.email || null,
    actorRole: staff.role,
    requestId,
    action: "client.export",
    targetType: "client",
    targetId: "*",
    result: "success" as const,
    reason: null,
    before: null,
    after: redact({ rows, ...filters }),
    error: null,
  };
  if (isDemo()) {
    demo.auditLogs.unshift({ id: requestId, ...entry, action: entry.action as AuditLogEntry["action"], targetType: "client", createdAt: new Date().toISOString() });
    return;
  }
  await db().collection("admin_audit_logs").add({ ...entry, createdAt: FieldValue.serverTimestamp() });
}
