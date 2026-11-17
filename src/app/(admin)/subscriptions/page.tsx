import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AuditTimeline, Card, ChipLink, EmptyState, LinkButton, PageHeader, Source, StatusBadge, SUB_UI } from "@/components/ui";
import { SubscriptionAdjustForm } from "@/components/forms";
import { requirePagePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { getSubscriptionsPage } from "@/lib/data/subscriptions";
import { EXPIRING_DAYS, SUBSCRIPTION_FILTERS, subscriptionsQuerySchema, type SubscriptionFilter, type SubscriptionsQuery } from "@/lib/data/subscriptions-query";
import { getPlans } from "@/lib/data/plans";
import { getAuditPage } from "@/lib/data/audit";
import { orNull, settle } from "@/lib/data/safe";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Abonnements" };

const FILTER_LABEL: Record<SubscriptionFilter, string> = { active: "Actifs", expiring: `Expirent ≤ ${EXPIRING_DAYS} j`, trial: "Essais", expired: "Expirés", cancelled: "Annulés" };
const FORM_STATUSES = ["trial", "active", "expired", "cancelled"] as const;

function href(q: SubscriptionsQuery, patch: Partial<Record<keyof SubscriptionsQuery, string | number | undefined>>) {
  const merged = { ...q, cursor: undefined, ...patch } as Record<string, unknown>;
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== "" && !(k === "size" && v === 25) && !(k === "dir" && v === "asc")) p.set(k, String(v));
  const s = p.toString();
  return `/subscriptions${s ? `?${s}` : ""}`;
}

/**
 * subscriptions/ read with the Admin SDK (§6), adjustments through
 * POST /admin/v1/subscriptions/:uid/adjustments (billing, super_admin), recent adjustments from the audit log.
 */
export default async function SubscriptionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const staff = await requirePagePermission("subscriptions:read");
  const q = subscriptionsQuerySchema.parse(await searchParams);
  const canAdjust = can(staff.role, "subscriptions:adjust");
  const [res, plans, recent] = await Promise.all([
    settle(getSubscriptionsPage(q)),
    orNull(getPlans()),
    can(staff.role, "audit:read") ? orNull(getAuditPage({ targetType: "subscription", limit: 8 })) : Promise.resolve(null),
  ]);
  const page = res.ok ? res.data : null;
  const error = !res.ok ? (res.error instanceof Error ? res.error.message : "Erreur inconnue") : null;
  const planList = plans ?? [];
  const filtered = Boolean(q.status || q.plan);

  return (
    <>
      <PageHeader
        title="Abonnements"
        subtitle="subscriptions/{uid}, triés par fin de période. « Expire bientôt » = actif avec une fin dans les 7 jours."
      />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
        <div className="zr-card zr-table-wrap" style={{ flex: "999 1 640px", minWidth: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "14px 16px", borderBottom: "1px solid var(--zira-border)" }}>
            <div className="zr-chips"><span className="zr-muted" style={{ fontSize: 12.5, width: 100 }}>Statut</span>
              <ChipLink href={href(q, { status: undefined })} on={!q.status}>Tous</ChipLink>
              {SUBSCRIPTION_FILTERS.map((s) => <ChipLink key={s} href={href(q, { status: s })} on={q.status === s}>{FILTER_LABEL[s]}</ChipLink>)}
            </div>
            {planList.length > 0 && (
              <div className="zr-chips"><span className="zr-muted" style={{ fontSize: 12.5, width: 100 }}>Plan</span>
                <ChipLink href={href(q, { plan: undefined })} on={!q.plan}>Tous</ChipLink>
                {planList.map((p) => <ChipLink key={p.id} href={href(q, { plan: p.id })} on={q.plan === p.id}>{p.name}</ChipLink>)}
                {filtered && <Link href="/subscriptions" className="zr-link" style={{ fontSize: 13, marginLeft: 4 }}>Réinitialiser</Link>}
              </div>
            )}
          </div>

          {error ? (
            <EmptyState error title="Impossible de charger les abonnements" text={error.includes("index") ? "Index Firestore manquant pour cette combinaison de filtres : déployez firestore.indexes.json." : "La lecture a échoué. Réessayez dans un instant."} action={<LinkButton href={href(q, {})} size="sm">Réessayer</LinkButton>} />
          ) : page && page.items.length === 0 ? (
            <EmptyState title="Aucun abonnement" text="Aucun abonnement ne correspond aux filtres actifs." action={filtered ? <LinkButton href="/subscriptions" size="sm" variant="ghost">Réinitialiser les filtres</LinkButton> : undefined} />
          ) : page && (
            <div className="zr-table-scroll">
              <table className="zr-table">
                <caption className="sr-only">Abonnements</caption>
                <thead>
                  <tr>
                    <th scope="col">Client</th>
                    <th scope="col">Plan</th>
                    <th scope="col">Statut</th>
                    <th scope="col" aria-sort={q.dir === "asc" ? "ascending" : "descending"}>
                      <Link href={href(q, { dir: q.dir === "asc" ? "desc" : "asc" })} scroll={false}>Fin de période <span aria-hidden="true">{q.dir === "asc" ? "↑" : "↓"}</span></Link>
                    </th>
                    <th scope="col">Cycle</th>
                    <th scope="col">Renouvellement</th>
                    {canAdjust && <th scope="col"><span className="sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((s) => {
                    const ui = SUB_UI[s.status];
                    const formStatus = (FORM_STATUSES as readonly string[]).includes(s.rawStatus) ? (s.rawStatus as (typeof FORM_STATUSES)[number]) : "";
                    return (
                      <tr key={s.uid}>
                        <td><Link href={`/clients/${encodeURIComponent(s.uid)}`} className="row-link">{s.name}</Link>{s.email && <span className="zr-cell-sub">{s.email}</span>}</td>
                        <td>{s.planId}</td>
                        <td><StatusBadge status={ui.tone}>{s.status === "free" ? s.rawStatus || "—" : ui.label}</StatusBadge></td>
                        <td>{fmtDate(s.endDate)}{s.startDate && <span className="zr-cell-sub">depuis le {fmtDate(s.startDate)}</span>}</td>
                        <td>{s.billingCycle === "yearly" ? "Annuel" : s.billingCycle === "monthly" ? "Mensuel" : s.billingCycle ?? "—"}</td>
                        <td>{s.autoRenew == null ? "—" : s.autoRenew ? "Automatique" : "Désactivé"}</td>
                        {canAdjust && (
                          <td style={{ textAlign: "right" }}>
                            <SubscriptionAdjustForm
                              uid={s.uid}
                              clientName={s.name}
                              plans={planList.some((p) => p.id === s.planId) ? planList : [{ id: s.planId, name: s.planId }, ...planList]}
                              initial={{ planId: s.planId, status: formStatus, endDate: s.endDate }}
                            />
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {page && page.items.length > 0 && (
            <div className="zr-pager">
              <span className="zr-num">{page.items.length} abonnement{page.items.length > 1 ? "s" : ""} sur cette page{page.hasMore ? " · d'autres suivent" : ""}</span>
              <div className="zr-pager__btns">
                <LinkButton href={href(q, {})} size="sm" icon={ChevronLeft} disabled={!q.cursor}>Première page</LinkButton>
                <LinkButton href={page.nextCursor ? href(q, { cursor: page.nextCursor }) : "#"} size="sm" icon={ChevronRight} disabled={!page.hasMore}>Suivant</LinkButton>
              </div>
            </div>
          )}
        </div>

        {recent && (
          <div style={{ flex: "1 1 320px", minWidth: 0 }}>
            <Card title="Derniers ajustements" aside={<Source>audit-logs · subscription</Source>}>
              <AuditTimeline entries={recent.items} />
              {recent.hasMore && <p style={{ margin: "12px 0 0" }}><Link className="zr-link" href="/audit?targetType=subscription">Tout le journal des abonnements</Link></p>}
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
