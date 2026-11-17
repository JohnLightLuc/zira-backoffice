import Link from "next/link";
import { AuditTimeline, Card, ChipLink, EmptyState, PageHeader, Source } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/session";
import { auditLogsQuerySchema } from "@/lib/admin-api/schemas";
import { AdminApiError } from "@/lib/admin-api/core";
import { AUDIT_TARGET_TYPES } from "@/lib/admin-api/types";
import { getAuditPage } from "@/lib/data/audit";
import { settle } from "@/lib/data/safe";

export const metadata = { title: "Journal d'audit" };

const TARGET_LABEL = { client: "Clients", subscription: "Abonnements", device: "Devices", staff: "Staff" } as const;

type Q = ReturnType<typeof auditLogsQuerySchema.parse>;
function href(q: Q, patch: Partial<Record<keyof Q, string | undefined>>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...q, cursor: undefined, ...patch })) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return `/audit${s ? `?${s}` : ""}`;
}

/** GET /admin/v1/audit-logs — strict equality filters, createdAt desc, "Suivant" only (§5.6). */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePagePermission("audit:read");
  const q = auditLogsQuerySchema.parse(await searchParams);
  const res = await settle(getAuditPage({ ...q, limit: q.limit ?? 50 }));
  const err = !res.ok && res.error instanceof AdminApiError ? res.error : null;
  return (
    <>
      <PageHeader title="Journal d'audit" subtitle="Toutes les mutations du backoffice, succès et échecs, secrets masqués. Append-only." />
      <div className="zr-chips">
        <ChipLink href={href(q, { targetType: undefined, targetId: undefined })} on={!q.targetType}>Tout</ChipLink>
        {AUDIT_TARGET_TYPES.map((t) => <ChipLink key={t} href={href(q, { targetType: t, targetId: undefined })} on={q.targetType === t}>{TARGET_LABEL[t]}</ChipLink>)}
        {q.targetId && <ChipLink href={href(q, { targetId: undefined })} on>Cible {q.targetId} ✕</ChipLink>}
        {q.actorUid && <ChipLink href={href(q, { actorUid: undefined })} on>Acteur {q.actorUid} ✕</ChipLink>}
        {q.action && <ChipLink href={href(q, { action: undefined })} on>Action {q.action} ✕</ChipLink>}
      </div>
      <div style={{ maxWidth: 860 }}>
        <Card title="Entrées" aside={<Source>GET /admin/v1/audit-logs</Source>}>
          {!res.ok ? (
            <EmptyState error title="Journal indisponible" text={err?.status === 500 ? "Erreur serveur : un index composite Firestore manque peut-être pour ce filtre (voir les logs backend)." : err?.message ?? "L'API d'administration n'a pas répondu."} requestId={err?.requestId ?? undefined} />
          ) : (
            <>
              <AuditTimeline entries={res.data.items} />
              {res.data.hasMore && res.data.nextCursor && (
                <div className="zr-pager"><span /><Link className="zr-btn zr-btn--secondary zr-btn--sm" href={href(q, { cursor: res.data.nextCursor })}>Suivant</Link></div>
              )}
            </>
          )}
        </Card>
      </div>
    </>
  );
}
