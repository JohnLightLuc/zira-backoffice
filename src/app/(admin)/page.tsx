import Link from "next/link";
import { z } from "zod";
import { Alert, Card, MetricCard, Source, StatusBadge, SUB_UI } from "@/components/ui";
import { DateRangeFilter } from "@/components/client";
import { requirePagePermission } from "@/lib/auth/session";
import { getDashboard } from "@/lib/data/dashboard";
import { fmtDate, fmtDateTime, fmtDelta, fmtNumber, fmtXof } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import type { Period } from "@/lib/data/types";

export const metadata = { title: "Tableau de bord" };

const PERIOD_LABEL: Record<Period, string> = { day: "Aujourd'hui", week: "7 derniers jours", month: "Mois précédent", custom: "28 derniers jours" };
const COMPARE_LABEL: Record<Period, string> = { day: "vs hier", week: "vs 7 j précédents", month: "vs mois d'avant", custom: "vs période précédente" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const staff = await requirePagePermission("dashboard:read");
  const period = z.enum(["day", "week", "month", "custom"]).catch("week").parse((await searchParams).period);
  const d = await getDashboard(period, staff);
  const pl = PERIOD_LABEL[period];
  const delta = (cur: number | null, prev: number | null | undefined) => {
    const x = fmtDelta(cur, prev);
    return x ? { value: x.value, direction: x.direction, tone: x.pct >= 0 ? ("positive" as const) : ("negative" as const), label: COMPARE_LABEL[period] } : null;
  };
  const totalSubs = d.subscriptionsByStatus.reduce((a, s) => a + s.count, 0) || 1;
  const max = Math.max(1, ...d.newAccountsSeries.map((b) => b.value));

  return (
    <>
      <PageHeader title="Tableau de bord" subtitle="Santé du service et activité, tous clients confondus. Fuseau : UTC (Abidjan)." actions={<DateRangeFilter value={period} from={fmtDate(d.from)} to={fmtDate(d.to)} />} />

      <div className="zr-grid zr-grid--4">
        <MetricCard label="Clients actifs" period={pl} value={fmtNumber(d.activeClients.value)} delta={delta(d.activeClients.value, d.activeClients.previous)} definition="comptes non suspendus, au moins une connexion sur la période." />
        <MetricCard label="Nouveaux comptes" period={pl} value={fmtNumber(d.newAccounts.value)} delta={delta(d.newAccounts.value, d.newAccounts.previous)} definition="comptes créés sur la période (Auth creationTime)." />
        <MetricCard label="Abonnements payants actifs" period="Maintenant" value={fmtNumber(d.paidActiveSubscriptions.value)} hint={d.paidActiveSubscriptions.trials != null ? `dont ${fmtNumber(d.paidActiveSubscriptions.trials)} en essai` : undefined} definition="statut actif, à échéance proche ou en essai, hors plan gratuit." source="subscriptions (Firestore)" />
        {d.devicesOnline.total != null ? (
          <MetricCard label="Devices en ligne" period="Maintenant" value={fmtNumber(d.devicesOnline.online)} unit={`/ ${fmtNumber(d.devicesOnline.total)}`} status={{ tone: "maintenance", label: `${fmtNumber(d.devicesOnline.silent)} silencieux` }} definition="dernier signal reçu il y a moins de 30 min." source="Traccar via API admin" />
        ) : (
          <MetricCard label="Devices en ligne" period="Maintenant" value="—" status={{ tone: "neutral", label: "Source non connectée" }} definition="nécessite GET /admin/v1/devices/stats côté backend." />
        )}
      </div>

      <div className="zr-grid zr-grid--2-1">
        <Card title={`Nouveaux comptes · ${pl.toLowerCase()}`} aside={<Source>Firebase Auth</Source>}>
          <figure style={{ margin: 0 }} aria-label={`Nouveaux comptes par intervalle : ${d.newAccountsSeries.map((b) => `${b.label} ${b.value}`).join(", ")}`}>
            <div className="bars" role="img" aria-hidden="true">
              {d.newAccountsSeries.map((b) => (
                <div key={b.label}><b>{b.value}</b><i style={{ height: Math.max(3, Math.round((b.value / max) * 190)) }} /></div>
              ))}
            </div>
            <div className="bar-labels" aria-hidden="true">{d.newAccountsSeries.map((b) => <span key={b.label}>{b.label}</span>)}</div>
          </figure>
        </Card>
        <Card title="Abonnements par statut" aside={<Source>subscriptions</Source>}>
          {d.subscriptionsByStatus.map((s) => (
            <Link key={s.status} href={`/clients?sub=${s.status}`} className="statrow">
              <StatusBadge status={SUB_UI[s.status].tone}>{SUB_UI[s.status].label}</StatusBadge>
              <b className="zr-num">{fmtNumber(s.count)}</b>
              <span className="track"><span style={{ width: `${(s.count / totalSubs) * 100}%` }} /></span>
            </Link>
          ))}
        </Card>
      </div>

      <Alert tone="info" title="MRR / ARR non affichés">Ces chiffres apparaîtront quand les événements RevenueCat seront réconciliés côté serveur. Ils ne sont jamais déduits du seul plan Firestore.</Alert>

      <div className="zr-grid zr-grid--3">
        <Card title="Paiements journaliers des chauffeurs">
          {d.payments ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <dl className="zr-dl" style={{ gridTemplateColumns: "1fr auto" }}>
                <dt>Attendu</dt><dd className="zr-num" style={{ justifyContent: "flex-end" }}>{fmtXof(d.payments.expected)}</dd>
                <dt>Reçu</dt><dd className="zr-num" style={{ justifyContent: "flex-end" }}>{fmtXof(d.payments.received)}</dd>
                <dt>Impayé</dt><dd className="zr-num" style={{ justifyContent: "flex-end", color: "var(--zira-status-inactive-ink)", fontWeight: 600 }}>{fmtXof(d.payments.unpaid)}</dd>
              </dl>
              <Source>payment_logs : suivi opérationnel déclaré, pas un encaissement réel</Source>
            </div>
          ) : <p className="zr-muted">Source non disponible.</p>}
        </Card>
        <Card title="Documents à échéance" aside={<Source>documents.validTo</Source>}>
          {d.documents ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {([["Expirés", d.documents.expired, "inactive"], ["J0 à J-3", d.documents.within3Days, "maintenance"], ["J-4 à J-7", d.documents.within7Days, "available"]] as const).map(([l, n, t]) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><StatusBadge status={t}>{l}</StatusBadge><b className="zr-num">{fmtNumber(n)}</b></div>
              ))}
            </div>
          ) : <p className="zr-muted">Source non disponible.</p>}
        </Card>
        <Card title="Tâches planifiées" aside={<Source>Cloud Logging</Source>}>
          {d.jobs ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {d.jobs.map((j) => (
                <div key={j.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <div style={{ minWidth: 0 }}><span className="zr-code" style={{ display: "block" }}>{j.name}</span><span className="zr-cell-sub">Dernière exécution {fmtDateTime(j.lastRunAt)}</span></div>
                  <StatusBadge status={j.ok == null ? "neutral" : j.ok ? "active" : "inactive"}>{j.ok == null ? "Inconnu" : j.ok ? "OK" : "Échec"}</StatusBadge>
                </div>
              ))}
            </div>
          ) : <p className="zr-muted" style={{ margin: 0 }}>Cloud Logging / Error Reporting pas encore branché côté serveur (spec §7.6).</p>}
        </Card>
      </div>
    </>
  );
}
