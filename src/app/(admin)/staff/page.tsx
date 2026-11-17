import { TriangleAlert } from "lucide-react";
import { EmptyState, iconProps, PageHeader, StatusBadge } from "@/components/ui";
import { GrantStaffForm, ROLE_LABEL, StaffRoleForm } from "@/components/forms";
import { StaffAccessButton } from "@/components/actions";
import { requirePagePermission } from "@/lib/auth/session";
import { adminApi } from "@/lib/admin-api/client";
import { AdminApiError } from "@/lib/admin-api/core";
import { settle } from "@/lib/data/safe";
import { fmtDateTime } from "@/lib/format";
import type { StaffMember } from "@/lib/admin-api/types";

export const metadata = { title: "Personnel" };

/** lastSignInTime is an HTTP date from Firebase ("Mon, 10 Nov 2026 08:00:00 GMT"), not ISO (§5.5). */
function lastSignIn(v: string | null) {
  if (!v) return "Jamais";
  const t = Date.parse(v);
  return Number.isNaN(t) ? v : fmtDateTime(new Date(t).toISOString());
}

const ROLE_ORDER = ["super_admin", "support", "billing", "viewer"] as const;
const byRole = (a: StaffMember, b: StaffMember) =>
  ROLE_ORDER.indexOf(a.role ?? "viewer") - ROLE_ORDER.indexOf(b.role ?? "viewer") || (a.email ?? "").localeCompare(b.email ?? "");

/** GET /admin/v1/staff — super_admin only; full list, not paginated (BACKOFFICE_API.md §5.5). */
export default async function StaffPage() {
  const me = await requirePagePermission("staff:manage");
  const res = await settle(adminApi.staff());
  const err = !res.ok && res.error instanceof AdminApiError ? res.error : null;
  const members = res.ok ? [...res.data].sort(byRole) : [];
  const noMfa = members.filter((m) => !m.mfaEnrolled && !m.disabled).length;

  return (
    <>
      <PageHeader
        title="Personnel"
        subtitle="Comptes ayant accès au backoffice (claim staffRole). Changement de rôle, retrait ou suspension révoquent les sessions de la personne concernée."
        actions={<GrantStaffForm />}
      />
      {noMfa > 0 && (
        <div className="zr-alert zr-alert--warning" role="status" style={{ display: "flex", gap: 10 }}>
          <TriangleAlert {...iconProps} />
          <div><b>{noMfa} membre{noMfa > 1 ? "s" : ""} sans second facteur.</b> La connexion au backoffice est refusée tant que la MFA n&apos;est pas enregistrée.</div>
        </div>
      )}
      <div className="zr-card zr-table-wrap">
        {!res.ok ? (
          <EmptyState error title="Impossible de charger le personnel" text={err?.message ?? "L'API d'administration n'a pas répondu."} requestId={err?.requestId ?? undefined} />
        ) : members.length === 0 ? (
          <EmptyState title="Aucun membre" text="Aucun compte ne porte de rôle staff." />
        ) : (
          <div className="zr-table-scroll">
            <table className="zr-table">
              <caption className="sr-only">Membres du personnel</caption>
              <thead><tr><th scope="col">Membre</th><th scope="col">Rôle</th><th scope="col">Second facteur</th><th scope="col">Compte</th><th scope="col">Dernière connexion</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {members.map((m) => {
                  const self = m.uid === me.uid;
                  return (
                    <tr key={m.uid}>
                      <td><span className="zr-cell-main">{m.displayName ?? m.email ?? m.uid}{self && <span className="zr-muted"> (vous)</span>}</span><span className="zr-cell-sub">{m.email ?? "—"} · <span className="zr-code">{m.uid}</span></span></td>
                      <td>{m.role ? <span className="zr-role">{ROLE_LABEL[m.role]}</span> : "—"}</td>
                      <td>{m.mfaEnrolled ? <StatusBadge status="active">Enregistré</StatusBadge> : <StatusBadge status="maintenance">Absent</StatusBadge>}</td>
                      <td>{m.disabled ? <StatusBadge status="inactive">Suspendu</StatusBadge> : <StatusBadge status="active">Actif</StatusBadge>}</td>
                      <td>{lastSignIn(m.lastSignInTime)}</td>
                      <td style={{ textAlign: "right" }}>
                        {self ? <span className="zr-muted" style={{ fontSize: 12.5 }}>Votre propre accès ne se modifie pas ici</span> : m.role && (
                          <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                            <StaffRoleForm uid={m.uid} email={m.email} role={m.role} />
                            <StaffAccessButton uid={m.uid} label={m.displayName ?? m.email ?? m.uid} role={ROLE_LABEL[m.role]} disabled={m.disabled} />
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
