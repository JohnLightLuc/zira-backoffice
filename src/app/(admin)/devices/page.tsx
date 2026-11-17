import Link from "next/link";
import { X } from "lucide-react";
import { Alert, ChipLink, EmptyState, iconProps, LINK_UI, MetricCard, PageHeader, SignalAge, StatusBadge } from "@/components/ui";
import { DeviceDisabledButton } from "@/components/actions";
import { DeviceEditForm, DeviceLinkForm } from "@/components/forms";
import { requirePagePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { DEVICE_FILTERS, devicesQuerySchema, getDevice, getDeviceCounts, getDevicesPage, ISSUE_LABEL, ORPHAN_LABEL, type DeviceFilter, type DevicesQuery } from "@/lib/data/devices";
import { orNull, settle } from "@/lib/data/safe";
import { AdminApiError } from "@/lib/admin-api/core";
import { fmtDateTime, fmtNumber } from "@/lib/format";

export const metadata = { title: "Parc & GPS" };

const FILTER_LABEL: Record<DeviceFilter, string> = { all: "Tous", silent: "Silencieux", never: "Jamais vus", disabled: "Désactivés", unlinked: "Sans véhicule" };

function href(q: DevicesQuery, patch: Partial<Record<keyof DevicesQuery, string | number | undefined>>) {
  const m = { ...q, cursor: undefined, ...patch } as Record<string, unknown>;
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(m)) if (v !== undefined && v !== "" && !(k === "status" && v === "all") && !(k === "staleMinutes" && v === 30)) p.set(k, String(v));
  const s = p.toString();
  return `/devices${s ? `?${s}` : ""}`;
}

export default async function DevicesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const staff = await requirePagePermission("devices:read");
  const q = devicesQuerySchema.parse(await searchParams);
  const [pageRes, counts, selected] = await Promise.all([
    settle(getDevicesPage(q)),
    orNull(getDeviceCounts(q.staleMinutes)),
    q.device ? orNull(getDevice(q.device)) : Promise.resolve(null),
  ]);
  const page = pageRes.ok ? pageRes.data : null;
  const err = !pageRes.ok && pageRes.error instanceof AdminApiError ? pageRes.error : null;
  const now = Date.now();
  const canWrite = can(staff.role, "devices:write");

  return (
    <>
      <PageHeader
        title="Parc & GPS"
        subtitle="Devices Traccar croisés avec vehicles et users. Les incohérences sont signalées, jamais corrigées implicitement."
        actions={<span className="zr-muted" style={{ fontSize: 13 }}>Données à {fmtDateTime(new Date(now).toISOString())} · actualisation manuelle</span>}
      />

      {err && (err.status === 502 || err.status === 504) && (
        <Alert tone="danger" title="GPS indisponible">{err.message} <Link className="zr-link" href={href(q, {})}>Réessayer</Link> {err.requestId && <span className="zr-code">{err.requestId}</span>}</Alert>
      )}
      {err && err.status === 503 && !err.requestId && (
        <Alert tone="warning" title="API d'administration non configurée">Renseigner ADMIN_API_URL (fleet_backend, routes /admin/v1). Rien n&apos;est lu directement depuis Traccar.</Alert>
      )}

      {page?.orphans && page.orphans.length > 0 && (
        <Alert tone="warning" title={`Véhicules orphelins (${page.orphans.length})`}>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {page.orphans.map((o) => (
              <li key={o.vehicleId}>
                <span className="zr-code">{o.plate ?? o.vehicleId}</span> → device <span className="zr-code">{o.deviceId ?? "—"}</span> : {ORPHAN_LABEL[o.reason]}
                {o.ownerUid && <> · <Link className="zr-link" href={`/clients/${encodeURIComponent(o.ownerUid)}`}>client</Link></>}
              </li>
            ))}
          </ul>
          Signalé, jamais corrigé automatiquement.
        </Alert>
      )}

      <div className="zr-grid zr-grid--4">
        <MetricCard label="En ligne" period={`< ${q.staleMinutes} min`} value={fmtNumber(counts?.online)} unit={counts ? `/ ${fmtNumber(counts.total)}` : undefined} />
        <MetricCard label="Silencieux" period={`> ${q.staleMinutes} min`} value={fmtNumber(counts?.silent)} status={{ tone: "maintenance", label: "à surveiller" }} />
        <MetricCard label="Jamais vus" period="Total" value={fmtNumber(counts?.neverSeen)} status={{ tone: "inactive", label: "aucune position" }} />
        <MetricCard label="Incohérences" period="Total" value={fmtNumber(counts?.inconsistent)} status={{ tone: "inactive", label: "devices + véhicules orphelins" }} />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
        <div className="zr-card zr-table-wrap" style={{ flex: "999 1 640px", minWidth: 0 }}>
          <div className="zr-table-toolbar">
            {q.clientId && <ChipLink href={href(q, { clientId: undefined })} on>Client {q.clientId} ✕</ChipLink>}
            <div className="zr-chips">
              {DEVICE_FILTERS.map((f) => <ChipLink key={f} href={href(q, { status: f, device: undefined })} on={q.status === f}>{f === "silent" ? `Silencieux > ${q.staleMinutes} min` : FILTER_LABEL[f]}</ChipLink>)}
            </div>
          </div>
          {!page ? (
            <EmptyState error title="Impossible de charger les devices" text={err?.message ?? "L'API d'administration n'a pas répondu."} requestId={err?.requestId ?? undefined} />
          ) : page.items.length === 0 ? (
            <EmptyState title="Aucun device" text="Aucun device ne correspond au filtre." />
          ) : (
            <div className="zr-table-scroll">
              <table className="zr-table">
                <caption className="sr-only">Devices</caption>
                <thead><tr><th scope="col">Device</th><th scope="col">uniqueId</th><th scope="col">Client</th><th scope="col">Dernier signal</th><th scope="col">Rattachement</th></tr></thead>
                <tbody>
                  {page.items.map((d) => (
                    <tr key={d.id} className={selected?.id === d.id ? "is-selected" : undefined}>
                      <td><Link href={href(q, { device: d.id })} scroll={false} className="row-link">{d.name}</Link><span className="zr-cell-sub">Traccar <span className="zr-code" style={{ color: "inherit" }}>{d.id}</span>{d.model ? ` · ${d.model}` : ""}</span></td>
                      <td><span className="zr-code">{d.uniqueId}</span></td>
                      <td>{d.ownerUid ? <><Link className="zr-link" href={`/clients/${encodeURIComponent(d.ownerUid)}`}>{d.ownerName ?? d.ownerUid}</Link><span className="zr-cell-sub">{d.vehiclePlate ?? "—"}</span></> : <span className="zr-muted">—</span>}</td>
                      <td><SignalAge lastUpdate={d.lastUpdate} disabled={d.disabled} staleMinutes={q.staleMinutes} now={now} /></td>
                      <td><StatusBadge status={LINK_UI[d.link].tone}>{LINK_UI[d.link].label}</StatusBadge>{d.issues.length > 0 && <span className="zr-cell-sub">{d.issues.map((i) => ISSUE_LABEL[i]).join(" · ")}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {page && page.items.length > 0 && (
            <div className="zr-pager">
              <span className="zr-num">{page.items.length} device{page.items.length > 1 ? "s" : ""}{staff.demo ? " (démonstration)" : ""}</span>
              {page.hasMore && page.nextCursor ? <Link className="zr-btn zr-btn--secondary zr-btn--sm" href={href(q, { cursor: page.nextCursor })}>Suivant</Link> : <span>Cliquez un device pour voir son détail</span>}
            </div>
          )}
        </div>

        {selected && (
          <section className="zr-card" style={{ flex: "1 1 340px", minWidth: 0 }} aria-label="Détail du device">
            <div className="zr-card__head">
              <h2 className="zr-card__title">{selected.name}</h2>
              <Link href={href(q, { device: undefined })} scroll={false} className="zr-iconbtn" aria-label="Fermer le détail"><X {...iconProps} /></Link>
            </div>
            <div className="zr-card__body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <SignalAge lastUpdate={selected.lastUpdate} disabled={selected.disabled} staleMinutes={q.staleMinutes} now={now} />
              {selected.issues.length > 0 && (
                <Alert tone="warning" title="Incohérences signalées">
                  <ul style={{ margin: 0, paddingLeft: 18 }}>{selected.issues.map((i) => <li key={i}>{ISSUE_LABEL[i]}</li>)}</ul>
                </Alert>
              )}
              <dl className="zr-dl" style={{ gridTemplateColumns: "110px 1fr" }}>
                <dt>ID Traccar</dt><dd><span className="zr-code">{selected.id}</span></dd>
                <dt>uniqueId</dt><dd><span className="zr-code">{selected.uniqueId}</span></dd>
                <dt>Statut Traccar</dt><dd>{selected.status ?? "—"}</dd>
                <dt>Modèle</dt><dd>{selected.model ?? "—"}</dd>
                <dt>Client</dt><dd>{selected.ownerName ?? "—"}</dd>
                <dt>Véhicule</dt><dd>{selected.vehiclePlate ?? "—"}</dd>
              </dl>
              <div>
                <h3 style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600 }}>Dernières positions</h3>
                {selected.positions.length ? (
                  <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                    {selected.positions.map((p) => (
                      <li key={p.at} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13 }}>
                        <time className="zr-num" dateTime={p.at}>{fmtDateTime(p.at).slice(11, 16)}</time>
                        <span className="zr-code" style={{ color: "var(--zira-text-secondary)" }}>{p.lat.toFixed(4)}, {p.lon.toFixed(4)}</span>
                        <span className="zr-num">{p.speedKmh} km/h</span>
                      </li>
                    ))}
                  </ol>
                ) : <p className="zr-muted" style={{ margin: 0, fontSize: 13 }}>Aucune position reçue sur la fenêtre.</p>}
                <p className="zr-muted" style={{ margin: "8px 0 0", fontSize: 12 }}>Fenêtre bornée : 24 dernières heures.</p>
              </div>
              {canWrite && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <DeviceEditForm deviceId={selected.id} ownerUid={selected.ownerUid} initial={{ name: selected.name, uniqueId: selected.uniqueId, groupId: selected.groupId, phone: selected.phone, model: selected.model, contact: selected.contact, category: selected.category }} />
                  <DeviceDisabledButton deviceId={selected.id} ownerUid={selected.ownerUid} disabled={selected.disabled} name={selected.name} meta={`${selected.ownerName ?? "Sans client"} · ${selected.vehiclePlate ?? "—"}`} />
                  {!selected.vehicleId && <DeviceLinkForm deviceId={selected.id} label="Rattacher à un véhicule" />}
                </div>
              )}
              {!canWrite && <span className="zr-muted" style={{ fontSize: 12.5 }}>Désactivation réservée aux rôles support et super_admin.</span>}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
