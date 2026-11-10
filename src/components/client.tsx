"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import clsx from "clsx";
import {
  Activity, Calendar, Copy, CreditCard, FileText, LayoutDashboard, LogOut, MapPin, Search, ShieldCheck, Truck, Users, UserX, type LucideIcon,
} from "lucide-react";
import { Alert, Button, iconProps } from "@/components/ui";
import type { ActionResult } from "@/lib/actions";

/* Interactive pieces. Permissions are decided on the server and passed in as props. */

// ---------------------------------------------------------------- Navigation
const NAV: ({ group: string } | { href: string; label: string; icon: LucideIcon; key: string })[] = [
  { group: "Pilotage" },
  { href: "/", label: "Tableau de bord", icon: LayoutDashboard, key: "dashboard" },
  { group: "Clients" },
  { href: "/clients", label: "Clients", icon: Users, key: "clients" },
  { href: "/subscriptions", label: "Abonnements", icon: CreditCard, key: "subscriptions" },
  { group: "Opérations" },
  { href: "/devices", label: "Parc & GPS", icon: MapPin, key: "devices" },
  { href: "/activity", label: "Activité métier", icon: Truck, key: "activity" },
  { href: "/documents", label: "Documents", icon: FileText, key: "documents" },
  { group: "Exploitation" },
  { href: "/health", label: "Santé système", icon: Activity, key: "health" },
  { href: "/audit", label: "Journal d'audit", icon: ShieldCheck, key: "audit" },
];

export function NavLinks({ hidden, counts }: { hidden: string[]; counts: Record<string, number> }) {
  const pathname = usePathname();
  const items = NAV.filter((n) => !("key" in n) || !hidden.includes(n.key));
  return (
    <nav className="zr-nav" aria-label="Navigation principale">
      {items.map((n, i) => {
        if ("group" in n) return <div key={i} className="zr-nav__group">{n.group}</div>;
        const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
        const Icon = n.icon;
        return (
          <Link key={n.key} href={n.href} aria-current={active ? "page" : undefined}>
            <Icon {...iconProps} />
            {n.label}
            {counts[n.key] ? <span className="zr-nav__count" aria-label={`${counts[n.key]} à traiter`}>{counts[n.key]}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function LogoutButton({ demo }: { demo: boolean }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="zr-iconbtn"
      style={{ marginLeft: "auto", color: "var(--zira-text-on-primary-muted)" }}
      aria-label="Se déconnecter"
      title={demo ? "Mode démo : pas de session" : "Se déconnecter"}
      onClick={async () => {
        if (demo) return;
        await fetch("/api/session", { method: "DELETE" });
        router.replace("/login");
      }}
    >
      <LogOut {...iconProps} size={17} />
    </button>
  );
}

// ---------------------------------------------------------------- SearchField (debounced, URL-driven)
export function SearchField({ param = "q", placeholder, label, basePath, global }: { param?: string; placeholder: string; label: string; basePath?: string; global?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(global ? "" : params.get(param) ?? "");
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => {
      const target = basePath ?? pathname;
      const next = new URLSearchParams(target === pathname ? params.toString() : "");
      if (value.trim()) next.set(param, value.trim()); else next.delete(param);
      next.delete("cursor");
      router.replace(`${target}?${next.toString()}`, { scroll: false });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <label className="zr-search">
      <span className="sr-only">{label}</span>
      <Search {...iconProps} size={17} className="zr-icon" />
      <input type="search" value={value} placeholder={placeholder} onChange={(e) => setValue(e.target.value)} />
      {global && <kbd aria-hidden="true">⌘K</kbd>}
    </label>
  );
}

// ---------------------------------------------------------------- DateRangeFilter
const RANGES = [["day", "Jour"], ["week", "Semaine"], ["month", "Mois"], ["custom", "Personnalisée"]] as const;
export function DateRangeFilter({ value, from, to }: { value: string; from: string; to: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="zr-range" role="group" aria-label="Période" aria-busy={pending}>
      <div className="zr-seg">
        {RANGES.map(([k, l]) => (
          <button key={k} type="button" aria-pressed={value === k} onClick={() => start(() => router.replace(`/?period=${k}`, { scroll: false }))}>{l}</button>
        ))}
      </div>
      <span className="zr-range__dates"><Calendar {...iconProps} size={16} /><span className="zr-num">{from} → {to}</span><span className="zr-range__tz">UTC</span></span>
    </div>
  );
}

// ---------------------------------------------------------------- Copy
export function CopyButton({ value, label = "Copier l'UID", iconOnly }: { value: string; label?: string; iconOnly?: boolean }) {
  const [done, setDone] = useState(false);
  const copy = async () => { await navigator.clipboard.writeText(value).catch(() => {}); setDone(true); setTimeout(() => setDone(false), 1500); };
  if (iconOnly) return <button type="button" className="zr-iconbtn" style={{ width: 28, height: 28 }} aria-label={label} title={done ? "Copié" : label} onClick={copy}><Copy {...iconProps} size={14} /></button>;
  return <Button icon={Copy} onClick={copy}>{done ? "Copié" : label}</Button>;
}

// ---------------------------------------------------------------- ConfirmActionDialog
export function ConfirmAction(props: {
  trigger: { label: string; variant: "primary" | "secondary" | "danger"; icon?: LucideIcon };
  title: string; lead?: string; entityLabel: string; entityMeta?: string; entityId?: string;
  consequence: ReactNode; confirmLabel: string; tone?: "danger" | "warning"; minReason?: number;
  run: (reason: string, idempotencyKey: string) => Promise<ActionResult>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const idem = useRef<string>("");
  const router = useRouter();
  const titleId = useId(), reasonId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const min = props.minReason ?? 10;
  const tone = props.tone ?? "danger";

  useEffect(() => {
    if (!open) return;
    const el = dialogRef.current;
    el?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) setOpen(false);
      if (e.key === "Tab" && el) { // focus trap
        const f = el.querySelectorAll<HTMLElement>("button:not([disabled]), textarea");
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, pending]);

  const openDialog = () => { idem.current = crypto.randomUUID(); setReason(""); setResult(null); setOpen(true); };
  const confirm = () => start(async () => {
    const r = await props.run(reason.trim(), idem.current);
    setResult(r);
    if (r.ok) { setOpen(false); router.refresh(); }
  });
  const Icon = props.trigger.icon ?? UserX;

  return (
    <>
      <Button variant={props.trigger.variant} icon={props.trigger.icon} onClick={openDialog}>{props.trigger.label}</Button>
      {result?.ok && !open && (
        <div style={{ position: "fixed", right: 24, bottom: 24, zIndex: 60, maxWidth: 420 }}>
          <Alert tone="success">{result.message} <span className="zr-code">{result.requestId}</span></Alert>
        </div>
      )}
      {open && (
        <div className="zr-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !pending) setOpen(false); }}>
          <div ref={dialogRef} className={clsx("zr zr-dialog", tone === "warning" && "zr-dialog--warning")} role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
            <div className="zr-dialog__head">
              <span className="zr-dialog__badge"><Icon {...iconProps} size={20} /></span>
              <div><h3 id={titleId}>{props.title}</h3>{props.lead && <p className="zr-dialog__lead">{props.lead}</p>}</div>
            </div>
            <div className="zr-dialog__body">
              <div className="zr-entity">
                <div><div className="zr-entity__name">{props.entityLabel}</div>{props.entityMeta && <div className="zr-muted" style={{ fontSize: 12.5 }}>{props.entityMeta}</div>}</div>
                {props.entityId && <span className="zr-code">{props.entityId}</span>}
              </div>
              <Alert tone={tone === "warning" ? "warning" : "danger"} title="Conséquence">{props.consequence}</Alert>
              <div className="zr-field">
                <label htmlFor={reasonId}>Motif (obligatoire)</label>
                <textarea id={reasonId} rows={3} value={reason} maxLength={500} placeholder="Ex. : demande du client par e-mail, ticket #…" onChange={(e) => setReason(e.target.value)} />
                <span className="zr-field__help">Minimum {min} caractères. Visible dans le journal d&apos;audit.</span>
              </div>
              {result && !result.ok && <Alert tone="danger">{result.message} <span className="zr-code">{result.requestId}</span></Alert>}
            </div>
            <div className="zr-dialog__foot">
              <span className="zr-dialog__audit"><ShieldCheck {...iconProps} size={15} />Action journalisée</span>
              <div className="zr-dialog__actions">
                <Button onClick={() => setOpen(false)} disabled={pending}>Annuler</Button>
                <Button variant={tone === "warning" ? "primary" : "danger"} disabled={pending || reason.trim().length < min} onClick={confirm}>
                  {pending ? "En cours…" : props.confirmLabel}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
