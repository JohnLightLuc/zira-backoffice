import Link from "next/link";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { ChipLink, EmptyState, LinkButton, PageHeader, StatusBadge, SUB_UI } from "@/components/ui";
import { CopyButton, SearchField } from "@/components/client";
import { requirePagePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { getClientsPage } from "@/lib/data/clients";
import { clientsQuerySchema, type ClientsQuery } from "@/lib/data/clients-query";
import { fmtAge, fmtDate, fmtNumber, minutesSince } from "@/lib/format";
import { SUB_STATUSES } from "@/lib/data/types";

export const metadata = { title: "Clients" };

const PLANS = ["Gratuit", "Essentiel", "Pro", "Entreprise"]; // to align with plans/{planId} once its schema is validated

function href(q: ClientsQuery, patch: Partial<Record<keyof ClientsQuery, string | number | undefined>>) {
  const next: Record<string, string> = {};
  const merged = { ...q, cursor: undefined, ...patch } as Record<string, unknown>;
  for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== "" && v !== null && !(k === "size" && v === 25) && !(k === "sort" && v === "name") && !(k === "dir" && v === "asc")) next[k] = String(v);
  const s = new URLSearchParams(next).toString();
  return `/clients${s ? `?${s}` : ""}`;
}

export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const staff = await requirePagePermission("clients:read");
  const q = clientsQuerySchema.parse(await searchParams);
  let page: Awaited<ReturnType<typeof getClientsPage>> | null = null;
  let error: string | null = null;
  try {
    page = await getClientsPage(q);
  } catch (e) {
    error = e instanceof Error ? e.message : "Erreur inconnue";
  }
  const now = Date.now();
  const sortHeader = (key: ClientsQuery["sort"], label: string, numeric?: boolean) => {
    const active = q.sort === key;
    const nextDir = active && q.dir === "asc" ? "desc" : "asc";
    return (
      <th scope="col" className={numeric ? "is-num" : undefined} aria-sort={active ? (q.dir === "asc" ? "ascending" : "descending") : "none"}>
        <Link href={href(q, { sort: key, dir: nextDir })} scroll={false}>{label} <span aria-hidden="true">{active ? (q.dir === "asc" ? "↑" : "↓") : "↕"}</span></Link>
      </th>
    );
  };
  const filtered = Boolean(q.q || q.plan || q.sub);

  return (
    <>
      <PageHeader
        title="Clients"
        subtitle="Comptes propriétaires (Firebase Auth + users/{uid}), tous ownerId confondus."
        actions={can(staff.role, "clients:export")
          ? <LinkButton href={`/api/clients/export?${new URLSearchParams({ q: q.q, plan: q.plan, ...(q.sub ? { sub: q.sub } : {}) })}`} icon={Download}>Exporter CSV</LinkButton>
          : <LinkButton href="#" icon={Download} disabled>Exporter CSV</LinkButton>}
      />
      <div className="zr-card zr-table-wrap">
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "14px 16px", borderBottom: "1px solid var(--zira-border)" }}>
          <div style={{ maxWidth: 420 }}><SearchField placeholder="Nom, e-mail, téléphone ou UID" label="Rechercher un client" /></div>
          <div className="zr-chips"><span className="zr-muted" style={{ fontSize: 12.5, width: 100 }}>Plan</span>
            <ChipLink href={href(q, { plan: "" })} on={!q.plan}>Tous</ChipLink>
            {PLANS.map((p) => <ChipLink key={p} href={href(q, { plan: p })} on={q.plan === p}>{p}</ChipLink>)}
          </div>
          <div className="zr-chips"><span className="zr-muted" style={{ fontSize: 12.5, width: 100 }}>Abonnement</span>
            <ChipLink href={href(q, { sub: undefined })} on={!q.sub}>Tous</ChipLink>
            {SUB_STATUSES.map((s) => <ChipLink key={s} href={href(q, { sub: s })} on={q.sub === s}>{SUB_UI[s].label}</ChipLink>)}
            {filtered && <Link href="/clients" className="zr-link" style={{ fontSize: 13, marginLeft: 4 }}>Réinitialiser</Link>}
          </div>
        </div>

        {error ? (
          <EmptyState error title="Impossible de charger les clients" text={error.includes("index") ? "Index Firestore manquant : déployez firestore.indexes.json." : "La lecture a échoué. Réessayez dans un instant."} action={<LinkButton href={href(q, {})} size="sm">Réessayer</LinkButton>} />
        ) : page && page.items.length === 0 ? (
          <EmptyState title="Aucun client" text="Aucun client ne correspond à la recherche et aux filtres actifs." action={filtered ? <LinkButton href="/clients" size="sm" variant="ghost">Réinitialiser les filtres</LinkButton> : undefined} />
        ) : (
          <div className="zr-table-scroll">
            <table className="zr-table">
              <caption className="sr-only">Clients</caption>
              <thead>
                <tr>
                  {sortHeader("name", "Client")}
                  <th scope="col">UID</th>
                  <th scope="col">Plan</th>
                  <th scope="col">Abonnement</th>
                  {sortHeader("vehicles", "Véhicules", true)}
                  <th scope="col" className="is-num">Devices</th>
                  <th scope="col">Compte</th>
                  {sortHeader("lastSignIn", "Dernière connexion")}
                </tr>
              </thead>
              <tbody>
                {page!.items.map((c) => {
                  const st = SUB_UI[c.subStatus];
                  return (
                    <tr key={c.uid}>
                      <td>
                        <Link href={`/clients/${encodeURIComponent(c.uid)}`} className="row-link">{c.name}</Link>
                        {c.email && <span className="zr-cell-sub">{c.email}</span>}
                        {c.phone && <span className="zr-cell-sub">{c.phone}</span>}
                      </td>
                      <td><span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span className="zr-code">{c.uid.length > 14 ? `${c.uid.slice(0, 8)}…${c.uid.slice(-4)}` : c.uid}</span><CopyButton value={c.uid} iconOnly /></span></td>
                      <td>{c.plan}</td>
                      <td><StatusBadge status={st.tone}>{c.subStatus === "expiring" && c.subEndDate ? `Expire le ${fmtDate(c.subEndDate).slice(0, 5)}` : st.label}</StatusBadge>{c.subEndDate && <span className="zr-cell-sub" style={{ marginTop: 4 }}>Fin {fmtDate(c.subEndDate)}</span>}</td>
                      <td className="is-num">{fmtNumber(c.vehicleCount)}</td>
                      <td className="is-num">{fmtNumber(c.deviceCount)}</td>
                      <td>{c.authDisabled ? <StatusBadge status="inactive">Suspendu</StatusBadge> : c.emailVerified ? <StatusBadge status="active">Actif</StatusBadge> : <StatusBadge status="maintenance">E-mail non vérifié</StatusBadge>}</td>
                      <td>{fmtAge(minutesSince(c.lastSignInAt, now))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {page && page.items.length > 0 && (
          <div className="zr-pager">
            <span className="zr-num">{page.items.length} client{page.items.length > 1 ? "s" : ""} sur cette page{page.hasMore ? " · d'autres suivent" : ""}</span>
            <div className="zr-pager__btns">
              {/* cursor pagination: "back" returns to the first page (no total count is invented) */}
              <LinkButton href={href(q, {})} size="sm" icon={ChevronLeft} disabled={!q.cursor}>Première page</LinkButton>
              <LinkButton href={page.nextCursor ? href(q, { cursor: page.nextCursor }) : "#"} size="sm" icon={ChevronRight} disabled={!page.hasMore}>Suivant</LinkButton>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
