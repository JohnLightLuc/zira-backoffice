"use client";

import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { CalendarClock, Link2, MessageSquarePlus, Pencil, ShieldCheck, UserCog, UserPlus, type LucideIcon } from "lucide-react";
import { Alert, Button, iconProps } from "@/components/ui";
import { addClientNote, adjustSubscription, grantStaff, linkDevice, updateDevice, updateStaffRole, type ActionResult } from "@/lib/actions";
import { REASON_MAX, REASON_MIN } from "@/lib/admin-api/schemas";
import type { StaffRole, SubscriptionAdjustmentResult, SubscriptionState } from "@/lib/admin-api/types";

/*
 * Mutation forms (BACKOFFICE_API.md §5, §7.5). Every form:
 *  - shows the target and the consequence, requires a reason when the route does (5–500);
 *  - generates one Idempotency-Key per intention when it opens, kept for retries of the same
 *    submission and renewed as soon as the operator edits a field (§4.8);
 *  - sends only the fields the operator changed (PATCH device, subscription adjustment);
 *  - displays field errors, the backend message and the X-Request-Id; `changed: false` → "Aucun changement".
 * Permissions are decided by the server: these components are only rendered for allowed roles.
 */

type AnyResult = ActionResult<unknown>;
type Errors = Record<string, string[] | undefined>;

export const ROLE_LABEL: Record<StaffRole, string> = { super_admin: "Super admin", support: "Support", billing: "Facturation", viewer: "Lecture seule" };
const ROLES = Object.keys(ROLE_LABEL) as StaffRole[];

// ---------------------------------------------------------------- shell
interface DialogProps {
  trigger: { label: string; variant?: "primary" | "secondary" | "danger" | "ghost"; icon?: LucideIcon; size?: "md" | "sm" };
  title: string;
  lead?: string;
  entity?: { label: string; meta?: string; id?: string };
  consequence?: ReactNode;
  confirmLabel: string;
  tone?: "danger" | "warning" | "info";
  /** false for routes without `reason` (client notes) */
  reason?: boolean;
  /** extra client-side condition (e.g. at least one modified field) */
  ready?: boolean;
  onOpen?: () => void;
  submit: (reason: string, idempotencyKey: string) => Promise<AnyResult>;
  success?: (r: Extract<AnyResult, { ok: true }>) => ReactNode;
  children?: (ctx: { errors: Errors; touch: () => void }) => ReactNode;
}

export function FormDialog(p: DialogProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<AnyResult | null>(null);
  const [toast, setToast] = useState<Extract<AnyResult, { ok: true }> | null>(null);
  const [pending, start] = useTransition();
  const key = useRef("");
  const router = useRouter();
  const titleId = useId(), reasonId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const needsReason = p.reason !== false;
  const tone = p.tone ?? "warning";
  const Icon = p.trigger.icon ?? Pencil;

  useEffect(() => {
    if (!open) return;
    const el = ref.current;
    el?.querySelector<HTMLElement>("input, select, textarea")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) setOpen(false);
      if (e.key === "Tab" && el) {
        const f = el.querySelectorAll<HTMLElement>("button:not([disabled]), input, select, textarea");
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, pending]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 10_000);
    return () => clearTimeout(t);
  }, [toast]);

  const touch = () => { key.current = crypto.randomUUID(); if (result && !result.ok) setResult(null); };
  const openDialog = () => { key.current = crypto.randomUUID(); setReason(""); setResult(null); p.onOpen?.(); setOpen(true); };
  const submit = () => start(async () => {
    const r = await p.submit(reason.trim(), key.current);
    setResult(r);
    if (r.ok) { setOpen(false); setToast(r); router.refresh(); }
  });
  const errors: Errors = result && !result.ok ? result.fieldErrors ?? {} : {};
  const reasonOk = !needsReason || (reason.trim().length >= REASON_MIN && reason.length <= REASON_MAX);

  return (
    <>
      <Button variant={p.trigger.variant ?? "secondary"} size={p.trigger.size} icon={p.trigger.icon} onClick={openDialog}>{p.trigger.label}</Button>
      {toast && !open && (
        <div className="zr-toast" role="status">
          <Alert tone={toast.changed === false ? "info" : "success"}>
            {toast.message}
            {p.success?.(toast)}
          </Alert>
        </div>
      )}
      {open && (
        <div className="zr-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !pending) setOpen(false); }}>
          <div ref={ref} className={clsx("zr zr-dialog zr-dialog--form", tone === "warning" && "zr-dialog--warning", tone === "info" && "zr-dialog--info")} role="dialog" aria-modal="true" aria-labelledby={titleId}>
            <div className="zr-dialog__head">
              <span className="zr-dialog__badge"><Icon {...iconProps} size={20} /></span>
              <div><h3 id={titleId}>{p.title}</h3>{p.lead && <p className="zr-dialog__lead">{p.lead}</p>}</div>
            </div>
            <form className="zr-dialog__body" onSubmit={(e) => { e.preventDefault(); if (!pending && reasonOk && p.ready !== false) submit(); }} noValidate>
              {p.entity && (
                <div className="zr-entity">
                  <div><div className="zr-entity__name">{p.entity.label}</div>{p.entity.meta && <div className="zr-muted" style={{ fontSize: 12.5 }}>{p.entity.meta}</div>}</div>
                  {p.entity.id && <span className="zr-code">{p.entity.id}</span>}
                </div>
              )}
              {p.children?.({ errors, touch })}
              {p.consequence && <Alert tone={tone === "danger" ? "danger" : tone === "info" ? "info" : "warning"} title="Conséquence">{p.consequence}</Alert>}
              {needsReason && (
                <div className={clsx("zr-field", errors.reason && "is-invalid")}>
                  <label htmlFor={reasonId}>Motif (obligatoire)</label>
                  <textarea id={reasonId} rows={3} value={reason} maxLength={REASON_MAX} placeholder="Ex. : demande du client par e-mail, ticket #…" onChange={(e) => { touch(); setReason(e.target.value); }} />
                  <span className="zr-field__help">Entre {REASON_MIN} et {REASON_MAX} caractères. Visible dans le journal d&apos;audit.</span>
                  <FieldError errors={errors.reason} />
                </div>
              )}
              {result && !result.ok && (
                <Alert tone="danger">
                  {result.message}
                  {result.status === 409 && " Aucun déplacement implicite : la situation doit être résolue avant de réessayer."}
                  {result.requestId && <> <span className="zr-code">{result.requestId}</span></>}
                </Alert>
              )}
              <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
            </form>
            <div className="zr-dialog__foot">
              <span className="zr-dialog__audit"><ShieldCheck {...iconProps} size={15} />Action journalisée</span>
              <div className="zr-dialog__actions">
                <Button onClick={() => setOpen(false)} disabled={pending}>Annuler</Button>
                <Button variant={tone === "danger" ? "danger" : "primary"} disabled={pending || !reasonOk || p.ready === false} onClick={submit}>
                  {pending ? "En cours…" : p.confirmLabel}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function FieldError({ errors }: { errors?: string[] }) {
  return errors?.length ? <span className="zr-field__error" role="alert">{errors.join(" ")}</span> : null;
}

function Field({ label, error, help, children, id }: { label: string; error?: string[]; help?: string; children: ReactNode; id: string }) {
  return (
    <div className={clsx("zr-field", error && "is-invalid")}>
      <label htmlFor={id}>{label}</label>
      {children}
      {help && <span className="zr-field__help">{help}</span>}
      <FieldError errors={error} />
    </div>
  );
}

// ---------------------------------------------------------------- subscription adjustment (billing, super_admin)
type SubStatusInput = "" | "trial" | "active" | "expired" | "cancelled";
const STATUS_LABEL: Record<Exclude<SubStatusInput, "">, string> = { trial: "Essai", active: "Actif", expired: "Expiré", cancelled: "Annulé" };

/** `<input type="date">` value ↔ ISO (Africa/Abidjan = UTC; end of the selected day). */
const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const fromDateInput = (d: string) => `${d}T23:59:59.000Z`;

export function SubscriptionAdjustForm({ uid, clientName, initial, plans }: {
  uid: string;
  clientName: string;
  initial: { planId: string | null; status: SubStatusInput; endDate: string | null };
  plans: { id: string; name: string }[];
}) {
  const [planId, setPlanId] = useState(initial.planId ?? "");
  const [status, setStatus] = useState<SubStatusInput>(initial.status);
  const [endDate, setEndDate] = useState(toDateInput(initial.endDate));
  const ids = { plan: useId(), status: useId(), end: useId() };

  const changes = {
    planId: planId && planId !== initial.planId ? planId : undefined,
    status: status && status !== initial.status ? status : undefined,
    endDate: endDate && endDate !== toDateInput(initial.endDate) ? fromDateInput(endDate) : undefined,
  };
  const any = Object.values(changes).some((v) => v !== undefined);

  return (
    <FormDialog
      trigger={{ label: "Ajuster l'abonnement", icon: CalendarClock, size: "sm" }}
      title="Ajuster l'abonnement"
      lead="Ajustement manuel de subscriptions/{uid}. Seuls les champs modifiés sont envoyés."
      entity={{ label: clientName, id: uid }}
      consequence="Chaque ajustement valide est écrit et audité (pas de « aucun changement » ici). Les permissions sont recopiées depuis le plan choisi ; essai, cycle et renouvellement ne sont pas modifiés."
      confirmLabel="Appliquer l'ajustement"
      ready={any}
      onOpen={() => { setPlanId(initial.planId ?? ""); setStatus(initial.status); setEndDate(toDateInput(initial.endDate)); }}
      submit={(reason, idempotencyKey) => adjustSubscription({ uid, reason, idempotencyKey, ...changes })}
      success={(r) => <SubscriptionDiff result={r.data as SubscriptionAdjustmentResult} />}
    >
      {({ errors, touch }) => (
        <>
          <div className="zr-form-grid">
            <Field id={ids.plan} label="Plan" error={errors.planId}>
              <select id={ids.plan} value={planId} onChange={(e) => { touch(); setPlanId(e.target.value); }}>
                {!initial.planId && <option value="">—</option>}
                {plans.map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
              </select>
            </Field>
            <Field id={ids.status} label="Statut" error={errors.status}>
              <select id={ids.status} value={status} onChange={(e) => { touch(); setStatus(e.target.value as SubStatusInput); }}>
                {!initial.status && <option value="">—</option>}
                {(Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </Field>
            <Field id={ids.end} label="Fin de période (UTC)" error={errors.endDate} help="Actif / essai : date future. Expiré : date passée.">
              <input id={ids.end} type="date" value={endDate} onChange={(e) => { touch(); setEndDate(e.target.value); }} />
            </Field>
          </div>
          {!any && <span className="zr-field__help">Modifiez au moins un champ.</span>}
        </>
      )}
    </FormDialog>
  );
}

function fmtState(k: keyof SubscriptionState, v: unknown): string {
  if (v == null) return "—";
  if (k === "endDate") return new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", dateStyle: "short" }).format(new Date(String(v)));
  if (k === "permissions") return Object.keys(v as object).join(", ") || "—";
  return String(v);
}

export function SubscriptionDiff({ result }: { result: SubscriptionAdjustmentResult }) {
  const rows = (["planId", "status", "endDate", "permissions"] as const).filter((k) => JSON.stringify(result.before[k]) !== JSON.stringify(result.after[k]));
  if (!rows.length) return null;
  return (
    <div className="zr-diff" style={{ marginTop: 8 }}>
      {rows.map((k) => [
        <span key={`${k}l`} className="zr-muted">{k}</span>,
        <s key={`${k}b`}>{fmtState(k, result.before[k])}</s>,
        <span key={`${k}a`} aria-hidden="true">→</span>,
        <b key={`${k}n`}>{fmtState(k, result.after[k])}</b>,
      ])}
    </div>
  );
}

// ---------------------------------------------------------------- client note (support, super_admin)
export function ClientNoteForm({ uid, clientName }: { uid: string; clientName: string }) {
  const [body, setBody] = useState("");
  const id = useId();
  const len = body.trim().length;
  return (
    <FormDialog
      trigger={{ label: "Ajouter une note", icon: MessageSquarePlus, size: "sm" }}
      tone="info"
      title="Ajouter une note interne"
      lead="Visible par le support et la facturation, jamais par le client."
      entity={{ label: clientName, id: uid }}
      consequence="Les notes sont définitives : ni modification ni suppression."
      confirmLabel="Enregistrer la note"
      reason={false}
      ready={len >= 1 && body.length <= 2000}
      onOpen={() => setBody("")}
      submit={(_r, idempotencyKey) => addClientNote({ uid, body, idempotencyKey })}
    >
      {({ errors, touch }) => (
        <Field id={id} label="Note" error={errors.body} help={`${body.length} / 2000 caractères`}>
          <textarea id={id} rows={5} maxLength={2000} value={body} onChange={(e) => { touch(); setBody(e.target.value); }} />
        </Field>
      )}
    </FormDialog>
  );
}

// ---------------------------------------------------------------- device edit (support, super_admin)
export interface DeviceEditInitial { name: string; uniqueId: string; groupId: number | null; phone: string | null; model: string | null; contact: string | null; category: string | null }
const TEXT_FIELDS = [["name", "Nom"], ["uniqueId", "uniqueId (IMEI)"], ["model", "Modèle"], ["category", "Catégorie"], ["phone", "Téléphone (SIM)"], ["contact", "Contact"]] as const;

export function DeviceEditForm({ deviceId, ownerUid, initial }: { deviceId: string; ownerUid: string | null; initial: DeviceEditInitial }) {
  const init = () => ({ name: initial.name, uniqueId: initial.uniqueId, model: initial.model ?? "", category: initial.category ?? "", phone: initial.phone ?? "", contact: initial.contact ?? "", groupId: initial.groupId == null ? "" : String(initial.groupId) });
  const [v, setV] = useState(init);
  const base = init();
  const uid = useId();

  const fields: Record<string, unknown> = {};
  for (const [k] of TEXT_FIELDS) if (v[k] !== base[k]) fields[k] = k === "name" || k === "uniqueId" ? v[k].trim() : v[k];
  if (v.groupId !== base.groupId && v.groupId !== "") fields.groupId = Number(v.groupId);
  const groupInvalid = v.groupId !== "" && !/^-?\d+$/.test(v.groupId);
  const changed = Object.keys(fields).length > 0;

  return (
    <FormDialog
      trigger={{ label: "Modifier le device", icon: Pencil }}
      title="Modifier le device"
      lead="Le backend renvoie l'objet complet à Traccar : les champs non modifiés sont conservés."
      entity={{ label: initial.name, id: `Traccar ${deviceId}` }}
      consequence={v.uniqueId !== base.uniqueId ? "Le uniqueId change : les véhicules Firestore rattachés seront resynchronisés. Un mauvais IMEI coupe la remontée GPS." : "Mise à jour du device dans Traccar."}
      confirmLabel="Enregistrer"
      ready={changed && !groupInvalid && v.name.trim() !== "" && v.uniqueId.trim() !== ""}
      onOpen={() => setV(init())}
      submit={(reason, idempotencyKey) => updateDevice({ deviceId, ownerUid, idempotencyKey, fields: { reason, ...fields } })}
    >
      {({ errors, touch }) => (
        <>
          <div className="zr-form-grid">
            {TEXT_FIELDS.map(([k, label]) => (
              <Field key={k} id={`${uid}-${k}`} label={label} error={errors[k]}>
                <input id={`${uid}-${k}`} value={v[k]} onChange={(e) => { touch(); setV({ ...v, [k]: e.target.value }); }} />
              </Field>
            ))}
            <Field id={`${uid}-g`} label="Groupe Traccar (ID)" error={errors.groupId ?? (groupInvalid ? ["Entier attendu"] : undefined)}>
              <input id={`${uid}-g`} inputMode="numeric" value={v.groupId} onChange={(e) => { touch(); setV({ ...v, groupId: e.target.value }); }} />
            </Field>
          </div>
          <span className="zr-field__help">{changed ? `Champs envoyés : ${Object.keys(fields).join(", ")}.` : "Aucun champ modifié."} L&apos;état activé/désactivé se gère avec le bouton dédié.</span>
        </>
      )}
    </FormDialog>
  );
}

// ---------------------------------------------------------------- device link (support, super_admin)
/** Fixed values come from the screen (device page: deviceId; client fleet: ownerId + vehicleId). */
export function DeviceLinkForm({ deviceId, ownerId, vehicleId, label, size }: { deviceId?: string; ownerId?: string; vehicleId?: string; label: string; size?: "sm" | "md" }) {
  const [v, setV] = useState({ deviceId: deviceId ?? "", ownerId: ownerId ?? "", vehicleId: vehicleId ?? "" });
  const uid = useId();
  const valid = /^\d+$/.test(v.deviceId) && v.ownerId.trim() !== "" && v.vehicleId.trim() !== "";
  const input = (k: keyof typeof v, lbl: string, help?: string, fixed?: string) => (
    <Field id={`${uid}-${k}`} label={lbl} help={help}>
      <input id={`${uid}-${k}`} value={v[k]} readOnly={fixed !== undefined} inputMode={k === "deviceId" ? "numeric" : undefined} onChange={(e) => setV({ ...v, [k]: e.target.value.trim() })} />
    </Field>
  );
  return (
    <FormDialog
      trigger={{ label, icon: Link2, size }}
      title="Rattacher un device à un véhicule"
      lead="Ajoute la permission Traccar du client si besoin, puis écrit deviceId + uniqueId sur vehicles/{vehicleId}."
      consequence="Aucun déplacement implicite : si le véhicule ou le device est déjà rattaché ailleurs, l'API refuse (409). Le détachement n'est pas encore disponible : escalader dans ce cas."
      confirmLabel="Rattacher"
      ready={valid}
      onOpen={() => setV({ deviceId: deviceId ?? "", ownerId: ownerId ?? "", vehicleId: vehicleId ?? "" })}
      submit={(reason, idempotencyKey) => linkDevice({ ...v, reason, idempotencyKey })}
    >
      {({ touch }) => (
        <div className="zr-form-grid" onChange={touch}>
          {input("deviceId", "ID device Traccar", undefined, deviceId)}
          {input("ownerId", "UID du client", "Le client doit avoir un compte Traccar.", ownerId)}
          {input("vehicleId", "ID du véhicule", "Document vehicles/{id} appartenant à ce client.", vehicleId)}
        </div>
      )}
    </FormDialog>
  );
}

// ---------------------------------------------------------------- staff (super_admin)
export function GrantStaffForm() {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("viewer");
  const uid = useId();
  return (
    <FormDialog
      trigger={{ label: "Ajouter un membre", icon: UserPlus, variant: "primary" }}
      title="Donner l'accès au backoffice"
      lead="Le compte Firebase Auth doit déjà exister : aucune création de compte ni invitation n'est envoyée."
      consequence="Le claim staffRole est posé sur le compte. La personne doit enregistrer un second facteur (MFA) pour se connecter."
      confirmLabel="Donner l'accès"
      ready={/^\S+@\S+\.\S+$/.test(email.trim())}
      onOpen={() => { setEmail(""); setRole("viewer"); }}
      submit={(reason, idempotencyKey) => grantStaff({ email: email.trim(), role, reason, idempotencyKey })}
    >
      {({ errors, touch }) => (
        <div className="zr-form-grid">
          <Field id={`${uid}-e`} label="E-mail du compte" error={errors.email}>
            <input id={`${uid}-e`} type="email" autoComplete="off" value={email} onChange={(e) => { touch(); setEmail(e.target.value); }} />
          </Field>
          <Field id={`${uid}-r`} label="Rôle" error={errors.role}>
            <select id={`${uid}-r`} value={role} onChange={(e) => { touch(); setRole(e.target.value as StaffRole); }}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </Field>
        </div>
      )}
    </FormDialog>
  );
}

export function StaffRoleForm({ uid, email, role }: { uid: string; email: string | null; role: StaffRole }) {
  const [next, setNext] = useState<StaffRole | "none">(role);
  const id = useId();
  const revoke = next === "none";
  return (
    <FormDialog
      trigger={{ label: "Modifier", icon: UserCog, size: "sm" }}
      tone={revoke ? "danger" : "warning"}
      title={revoke ? "Retirer l'accès staff" : "Changer le rôle"}
      entity={{ label: email ?? uid, meta: `Rôle actuel : ${ROLE_LABEL[role]}`, id: uid }}
      consequence={revoke ? "Le claim staffRole est retiré et les sessions sont révoquées : la personne perd immédiatement l'accès." : "Les sessions de la personne sont révoquées : elle devra se reconnecter avec son nouveau rôle."}
      confirmLabel={revoke ? "Retirer l'accès" : "Changer le rôle"}
      ready={next !== role}
      onOpen={() => setNext(role)}
      submit={(reason, idempotencyKey) => updateStaffRole({ uid, role: revoke ? null : next, reason, idempotencyKey })}
    >
      {({ errors, touch }) => (
        <Field id={id} label="Nouveau rôle" error={errors.role}>
          <select id={id} value={next} onChange={(e) => { touch(); setNext(e.target.value as StaffRole | "none"); }}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}{r === role ? " (actuel)" : ""}</option>)}
            <option value="none">Retirer l&apos;accès staff</option>
          </select>
        </Field>
      )}
    </FormDialog>
  );
}
