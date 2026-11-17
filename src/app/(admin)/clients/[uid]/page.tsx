import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock } from "lucide-react";
import { Alert, AuditTimeline, Card, iconProps, LINK_UI, PageHeader, SignalAge, Source, StatusBadge, SUB_UI } from "@/components/ui";
import { CopyButton } from "@/components/client";
import { ClientAccessButton } from "@/components/actions";
import { ClientNoteForm, DeviceLinkForm, SubscriptionAdjustForm } from "@/components/forms";
import { getPlans } from "@/lib/data/plans";
import { orNull } from "@/lib/data/safe";
import { requirePagePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { getClientOverview } from "@/lib/data/clients";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";

export const metadata = { title: "Fiche client" };

const TABS = [["overview", "Vue d'ensemble"], ["fleet", "Véhicules et devices"], ["history", "Historique support"]] as const;

export default async function ClientPage({ params, searchParams }: { params: Promise<{ uid: string }>; searchParams: Promise<{ tab?: string }> }) {
  const staff = await requirePagePermission("clients:read");
  const { uid: rawUid } = await params;
  const uid = decodeURIComponent(rawUid);
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(uid)) notFound();
  const requestedTab = (await searchParams).tab;
  const tab = TABS.some(([k]) => k === requestedTab) ? requestedTab! : "overview";
  const c = await getClientOverview(uid, staff);
  if (!c) notFound();

  const sub = c.subscription;
  const subUi = sub ? SUB_UI[sub.status] : null;
  const canSuspend = can(staff.role, "clients:suspend");
  const canAdjust = can(staff.role, "subscriptions:adjust") && sub != null;
  const canNote = can(staff.role, "clients:note");
  const canLink = can(staff.role, "devices:write");
  const plans = canAdjust ? (await orNull(getPlans())) ?? [] : [];
  const meta = `${c.profile.email ?? "sans e-mail"}${sub ? ` · Plan ${sub.planId}` : ""}`;
  const now = Date.now();
  const lastSuspend = c.audit?.find((a) => a.code === "client.suspend" && a.result === "success");

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Clients", href: "/clients" }, { label: c.profile.name }]}
        title={c.profile.name}
        subtitle={`Client depuis le ${fmtDate(c.profile.createdAt)}${c.profile.userType ? ` · ${c.profile.userType}` : ""}`}
        actions={
          <>
            <CopyButton value={uid} />
            {canSuspend
              ? <ClientAccessButton uid={uid} name={c.profile.name} meta={meta} disabled={c.auth.disabled} />
              : <span className="zr-muted" style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}><Lock {...iconProps} size={15} />Lecture seule pour le rôle {staff.role}</span>}
          </>
        }
      />

      {c.auth.disabled && (
        <Alert tone="danger" title="Compte suspendu">
          {lastSuspend ? `Suspendu le ${fmtDateTime(lastSuspend.at)} par ${lastSuspend.actorName} (${lastSuspend.role}). Motif : ${lastSuspend.reason ?? "—"}` : "Le compte Firebase Auth est désactivé."}
        </Alert>
      )}

      <nav className="zr-tabs" aria-label="Sections de la fiche">
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/clients/${encodeURIComponent(uid)}${k === "overview" ? "" : `?tab=${k}`}`} aria-current={tab === k ? "page" : undefined} scroll={false}>
            {l}{k === "fleet" ? ` (${c.fleet.length})` : k === "history" && c.audit ? ` (${c.audit.length})` : ""}
          </Link>
        ))}
      </nav>

      {tab === "overview" && (
        <>
          {c.issues.map((msg, i) => <Alert key={i} tone="warning" title="Incohérence de rattachement" action={<Link className="zr-btn zr-btn--secondary zr-btn--sm" href={`/clients/${encodeURIComponent(uid)}?tab=fleet`}>Voir les devices</Link>}>{msg}</Alert>)}
          <div className="zr-grid zr-grid--3">
            <Card title="Profil" aside={<Source>users/{"{uid}"}</Source>}>
              <dl className="zr-dl">
                <dt>UID</dt><dd><span className="zr-code">{uid}</span></dd>
                <dt>E-mail</dt><dd>{c.profile.email ?? "—"}</dd>
                <dt>Téléphone</dt><dd>{c.profile.phone ?? "—"}</dd>
                <dt>Type</dt><dd>{[c.profile.userType, c.profile.role && `rôle ${c.profile.role}`].filter(Boolean).join(" · ") || "—"}</dd>
                <dt>Traccar user</dt><dd><span className="zr-code">{c.profile.traccarUserId ?? "—"}</span></dd>
              </dl>
            </Card>
            <Card title="Firebase Auth" aside={<Source>Admin Auth</Source>}>
              <dl className="zr-dl">
                <dt>État</dt><dd>{c.auth.disabled ? <StatusBadge status="inactive">Suspendu</StatusBadge> : <StatusBadge status="active">Actif</StatusBadge>}</dd>
                <dt>E-mail vérifié</dt><dd>{c.auth.emailVerified ? <StatusBadge status="active">Oui</StatusBadge> : <StatusBadge status="maintenance">Non</StatusBadge>}</dd>
                <dt>Créé le</dt><dd>{fmtDateTime(c.auth.createdAt)}</dd>
                <dt>Dernière connexion</dt><dd>{fmtDateTime(c.auth.lastSignInAt)}</dd>
              </dl>
            </Card>
            <Card title="Abonnement et droits" aside={<Source>subscriptions/{"{uid}"}</Source>}>
              {sub && subUi ? (<>
                <dl className="zr-dl">
                  <dt>Plan</dt><dd><b>{sub.planId}</b><StatusBadge status={subUi.tone}>{subUi.label}</StatusBadge></dd>
                  <dt>Fin de période</dt><dd>{fmtDate(sub.endDate)}</dd>
                  <dt>Cycle</dt><dd>{sub.billingCycle === "yearly" ? "Annuel" : sub.billingCycle === "monthly" ? "Mensuel" : sub.billingCycle ?? "—"}</dd>
                  <dt>Renouvellement</dt><dd>{sub.autoRenew == null ? "—" : sub.autoRenew ? "Automatique" : "Désactivé"}</dd>
                  <dt>Volumes</dt><dd>{fmtNumber(c.counts.vehicles)} véhicules · {fmtNumber(c.counts.drivers)} chauffeurs · {fmtNumber(c.counts.documents)} documents</dd>
                </dl>
                {canAdjust && (
                  <div style={{ marginTop: 16 }}>
                    <SubscriptionAdjustForm
                      uid={uid}
                      clientName={c.profile.name}
                      plans={plans.some((p) => p.id === sub.planId) ? plans : [{ id: sub.planId, name: sub.planId }, ...plans]}
                      initial={{ planId: sub.planId, status: sub.status === "expiring" ? "active" : sub.status === "free" ? "" : sub.status, endDate: sub.endDate }}
                    />
                  </div>
                )}
              </>) : <p className="zr-muted" style={{ margin: 0 }}>Aucun document subscriptions/{"{uid}"}.</p>}
            </Card>
          </div>
        </>
      )}

      {tab === "fleet" && c.devicesSource === "unavailable" && (
        <Alert tone="warning" title="Devices non vérifiés">L&apos;API d&apos;administration (GET /admin/v1/devices?clientId=) n&apos;a pas répondu : les rattachements ne sont pas vérifiés.</Alert>
      )}
      {tab === "fleet" && (
        <div className="zr-card zr-table-wrap">
          <div className="zr-table-scroll">
            <table className="zr-table">
              <caption className="sr-only">Véhicules et devices du client</caption>
              <thead><tr><th scope="col">Véhicule</th><th scope="col">Device Traccar</th><th scope="col">Dernier signal</th><th scope="col">Rattachement</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {c.fleet.map((f) => (
                  <tr key={f.vehicleId}>
                    <td><span className="zr-cell-main">{f.plate}</span><span className="zr-cell-sub">{f.label || "—"}</span></td>
                    <td>{f.device ? <><span className="zr-code">{f.device.id}</span><span className="zr-cell-sub">{f.device.uniqueId}</span></> : <span className="zr-muted">—</span>}</td>
                    <td>{f.device && f.link !== "unverified" ? <SignalAge lastUpdate={f.device.lastUpdate} disabled={f.device.disabled} now={now} /> : <span className="zr-muted">—</span>}</td>
                    <td><StatusBadge status={LINK_UI[f.link].tone}>{LINK_UI[f.link].label}</StatusBadge></td>
                    <td style={{ textAlign: "right" }}>
                      {f.device && <Link className="zr-link" href={`/devices?device=${encodeURIComponent(f.device.id)}`}>Voir le device</Link>}
                      {!f.device && canLink && <DeviceLinkForm ownerId={uid} vehicleId={f.vehicleId} label="Rattacher un device" size="sm" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "history" && (
        <div style={{ maxWidth: 760, display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title="Historique des actions support" aside={<Source>GET /admin/v1/audit-logs</Source>}>
            {c.audit ? <AuditTimeline entries={c.audit} /> : <p className="zr-muted" style={{ margin: 0 }}>{can(staff.role, "audit:read") ? "Journal d'audit indisponible." : `Journal d'audit non accessible au rôle ${staff.role}.`}</p>}
          </Card>
          {c.notes && (
            <Card title="Notes internes" aside={canNote ? <ClientNoteForm uid={uid} clientName={c.profile.name} /> : <Source>GET /admin/v1/clients/{"{uid}"}/notes</Source>}>
              {c.notes.length ? (
                <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                  {c.notes.map((n) => (
                    <li key={n.id}>
                      <div className="zr-muted" style={{ fontSize: 12.5 }}>{n.author} · {fmtDateTime(n.at)}</div>
                      <div style={{ whiteSpace: "pre-wrap" }}>{n.body}</div>
                    </li>
                  ))}
                </ol>
              ) : <p className="zr-muted" style={{ margin: 0 }}>Aucune note.</p>}
            </Card>
          )}
        </div>
      )}
    </>
  );
}
