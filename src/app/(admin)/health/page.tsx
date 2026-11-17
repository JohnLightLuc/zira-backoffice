import { Alert, Card, EmptyState, PageHeader, Source, StatusBadge } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/session";
import { adminApi } from "@/lib/admin-api/client";
import { AdminApiError } from "@/lib/admin-api/core";
import { settle } from "@/lib/data/safe";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "Santé système" };

const LABEL = { firestore: "Firestore", redis: "Redis (idempotence, rate limit)", traccar: "Traccar (/api/server)" } as const;

/** GET /admin/v1/health — always 200, read data.status (BACKOFFICE_API.md §5.1). Manual refresh only. */
export default async function Page() {
  await requirePagePermission("health:read");
  const res = await settle(adminApi.health());
  const err = !res.ok && res.error instanceof AdminApiError ? res.error : null;
  return (
    <>
      <PageHeader title="Santé système" subtitle="Dépendances vérifiées par l'API d'administration (fleet_backend)." />
      {!res.ok ? (
        <div className="zr-card"><EmptyState error title="Santé indisponible" text={err?.message ?? "L'API d'administration n'a pas répondu."} requestId={err?.requestId ?? undefined} /></div>
      ) : (
        <>
          {res.data.status === "degraded" && <Alert tone="warning" title="Service dégradé">Au moins une dépendance du backend est en panne.</Alert>}
          <Card title={`État global : ${res.data.status === "ok" ? "OK" : "dégradé"}`} aside={<Source>Vérifié le {fmtDateTime(res.data.checkedAt)}</Source>}>
            <dl className="zr-dl">
              {(Object.keys(LABEL) as (keyof typeof LABEL)[]).map((k) => {
                const c = res.data.checks[k];
                return [
                  <dt key={`${k}-dt`}>{LABEL[k]}</dt>,
                  <dd key={`${k}-dd`}>
                    <StatusBadge status={c.status === "up" ? "active" : "inactive"}>{c.status === "up" ? "Disponible" : "En panne"}</StatusBadge>{" "}
                    <span className="zr-num">{c.latencyMs} ms</span>{c.error && <span className="zr-cell-sub">{c.error}</span>}
                  </dd>,
                ];
              })}
            </dl>
          </Card>
        </>
      )}
    </>
  );
}
