import Link from "next/link";
import clsx from "clsx";
import { ArrowDownRight, ArrowUpRight, Check, Eye, Info, TriangleAlert, X, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { AuditEntry, LinkState, SubStatus, Tone } from "@/lib/data/types";
import { fmtAge, fmtDateTime, minutesSince } from "@/lib/format";

/* Presentational components of the Zira design system (no business logic, spec §12.3). */

export const iconProps = { size: 18, strokeWidth: 1.75, "aria-hidden": true } as const;

// ---------------------------------------------------------------- BrandLogo
export function BrandLogo({ tone = "primary", size = 32, subtitle, variant = "full" }: { tone?: "primary" | "white"; size?: number; subtitle?: string; variant?: "full" | "mark" | "app-icon" }) {
  if (variant === "app-icon") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src="/brand/zira-app-icon.jpg" width={size} height={size} alt="Zira" style={{ borderRadius: "22%" }} />;
  }
  const src = tone === "white" ? "/brand/zira-mark-white.png" : "/brand/zira-mark-primary.png";
  const w = Math.round((size * 563) / 705);
  return (
    <span className={clsx("zr-logo", tone === "white" && "zr-logo--white")}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} width={w} height={size} alt={variant === "mark" ? "Zira" : ""} />
      {variant === "full" && (
        <span className="zr-logo__words">
          <span className="zr-logo__name" style={{ fontSize: Math.round(size * 0.62) }}>Zira</span>
          {subtitle && <span className="zr-logo__sub">{subtitle}</span>}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------- Button
type Variant = "primary" | "secondary" | "ghost" | "danger";
export function buttonClass(variant: Variant = "secondary", size: "md" | "sm" = "md") {
  return clsx("zr-btn", `zr-btn--${variant}`, size === "sm" && "zr-btn--sm");
}
export function Button({ variant = "secondary", size = "md", icon: Icon, iconRight: IconRight, children, ...rest }: { variant?: Variant; size?: "md" | "sm"; icon?: LucideIcon; iconRight?: LucideIcon } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const s = size === "sm" ? 15 : 17;
  return (
    <button type="button" className={buttonClass(variant, size)} {...rest}>
      {Icon && <Icon {...iconProps} size={s} />}
      {children}
      {IconRight && <IconRight {...iconProps} size={s} />}
    </button>
  );
}
export function LinkButton({ href, variant = "secondary", size = "md", icon: Icon, children, disabled }: { href: string; variant?: Variant; size?: "md" | "sm"; icon?: LucideIcon; children: ReactNode; disabled?: boolean }) {
  if (disabled) return <span className={buttonClass(variant, size)} aria-disabled="true" style={{ background: "var(--zira-surface-muted)", color: "var(--zira-text-disabled)", cursor: "not-allowed" }}>{Icon && <Icon {...iconProps} size={15} />}{children}</span>;
  return <Link href={href} className={buttonClass(variant, size)}>{Icon && <Icon {...iconProps} size={size === "sm" ? 15 : 17} />}{children}</Link>;
}

// ---------------------------------------------------------------- StatusBadge
const DEFAULT_LABEL: Record<Tone, string> = { active: "Actif", maintenance: "Attention", inactive: "Inactif", available: "Disponible", neutral: "Inconnu" };
export function StatusBadge({ status = "neutral", children }: { status?: Tone; children?: ReactNode }) {
  return (
    <span className={clsx("zr-badge", `zr-badge--${status}`)}>
      <span className="zr-badge__dot" aria-hidden="true" />
      {children ?? DEFAULT_LABEL[status]}
    </span>
  );
}

export const SUB_UI: Record<SubStatus, { tone: Tone; label: string }> = {
  active: { tone: "active", label: "Actif" },
  trial: { tone: "available", label: "Essai" },
  expiring: { tone: "maintenance", label: "Expire bientôt" },
  expired: { tone: "inactive", label: "Expiré" },
  cancelled: { tone: "neutral", label: "Annulé" },
  free: { tone: "neutral", label: "Gratuit" },
};
export const LINK_UI: Record<LinkState | "no_device", { tone: Tone; label: string }> = {
  ok: { tone: "active", label: "Cohérent" },
  missing_in_traccar: { tone: "inactive", label: "Absent de Traccar" },
  unlinked: { tone: "maintenance", label: "Sans rattachement" },
  unverified: { tone: "neutral", label: "Non vérifié" },
  no_device: { tone: "neutral", label: "Sans device" },
};

// ---------------------------------------------------------------- EnvBadge
const ENV_LABEL = { production: "Production", staging: "Staging", development: "Développement" } as const;
export function EnvBadge({ env }: { env: keyof typeof ENV_LABEL }) {
  const Icon = env === "production" ? TriangleAlert : Info;
  return <span className={clsx("zr-env", `zr-env--${env}`)} title="Environnement courant"><Icon {...iconProps} size={14} />{ENV_LABEL[env]}</span>;
}

// ---------------------------------------------------------------- Alert
export function Alert({ tone = "info", title, children, action }: { tone?: "info" | "warning" | "danger" | "success"; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const Icon = tone === "success" ? Check : tone === "info" ? Info : TriangleAlert;
  return (
    <div className={clsx("zr-alert", `zr-alert--${tone}`)} role={tone === "danger" ? "alert" : "status"}>
      <Icon {...iconProps} />
      <div className="zr-alert__body">
        {title && <span className="zr-alert__title">{title}</span>}
        {children}
      </div>
      {action && <div className="zr-alert__action">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- MetricCard
export function MetricCard(p: {
  label: string; value: ReactNode; unit?: string; period: string;
  delta?: { value: string; direction: "up" | "down"; tone: "positive" | "negative" | "neutral"; label?: string } | null;
  status?: { tone: Tone; label: string }; hint?: string; definition?: string; source?: string;
}) {
  return (
    <section className="zr-card zr-metric" aria-label={p.label}>
      <div className="zr-metric__top">
        <span className="zr-metric__label">{p.label}</span>
        <span className="zr-metric__period">{p.period}</span>
      </div>
      <div className="zr-metric__value">{p.value}{p.unit && <span className="zr-metric__unit">{p.unit}</span>}</div>
      {(p.delta || p.status || p.hint) && (
        <div className="zr-metric__row">
          {p.status && <StatusBadge status={p.status.tone}>{p.status.label}</StatusBadge>}
          {p.delta && (
            <span className={clsx("zr-delta", `zr-delta--${p.delta.tone}`)}>
              {p.delta.direction === "down" ? <ArrowDownRight {...iconProps} size={14} strokeWidth={2} /> : <ArrowUpRight {...iconProps} size={14} strokeWidth={2} />}
              {p.delta.value}
            </span>
          )}
          {p.delta?.label && <span className="zr-muted">{p.delta.label}</span>}
          {p.hint && <span className="zr-muted">{p.hint}</span>}
        </div>
      )}
      {(p.definition || p.source) && (
        <div className="zr-metric__def">
          {p.definition && <span><b>Définition : </b>{p.definition}</span>}
          {p.source && <span style={{ display: "block", marginTop: 2 }}><b>Source : </b>{p.source}</span>}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- SignalAge
export function SignalAge({ lastUpdate, disabled, staleMinutes = 30, now }: { lastUpdate: string | null; disabled?: boolean; staleMinutes?: number; now: number }) {
  const m = minutesSince(lastUpdate, now);
  if (m == null) return <span className="zr-signal"><StatusBadge status="inactive">Jamais vu</StatusBadge><span className="zr-signal__time">Aucune position reçue</span></span>;
  const tone: Tone = disabled ? "neutral" : m <= staleMinutes ? "active" : "maintenance";
  const label = disabled ? "Désactivé" : m <= staleMinutes ? "En ligne" : "Silencieux";
  return (
    <span className="zr-signal">
      <StatusBadge status={tone}>{`${label} · ${fmtAge(m)}`}</StatusBadge>
      <span className="zr-signal__time"><time dateTime={lastUpdate!}>{fmtDateTime(lastUpdate)}</time></span>
    </span>
  );
}

// ---------------------------------------------------------------- AuditTimeline
export function AuditTimeline({ entries }: { entries: AuditEntry[] }) {
  if (!entries.length) return <p className="zr-muted" style={{ margin: 0 }}>Aucune action enregistrée.</p>;
  return (
    <ol className="zr-audit">
      {entries.map((e) => {
        const Icon = e.result === "failure" ? X : e.result === "read" ? Eye : Check;
        return (
          <li key={e.id}>
            <span className={clsx("zr-audit__node", `zr-audit__node--${e.result}`)} aria-hidden="true"><Icon {...iconProps} size={14} strokeWidth={2.25} /></span>
            <div>
              <div className="zr-audit__line">
                <span className="zr-audit__action">{e.action}{e.result === "failure" && <span className="zr-muted"> — échec</span>}</span>
                <time className="zr-audit__when" dateTime={e.at}>{fmtDateTime(e.at)}</time>
              </div>
              <div className="zr-audit__meta">
                <span>{e.actorName}</span><span className="zr-role">{e.role}</span>
                <span>→ <span className="zr-code">{e.targetType}/{e.targetId}</span></span>
                <span>· req <span className="zr-code">{e.requestId}</span></span>
              </div>
              {e.change && <div className="zr-audit__diff"><span className="zr-muted">{e.change.field} :</span><s>{e.change.before}</s><span aria-hidden="true">→</span><b>{e.change.after}</b></div>}
              {e.reason && <div className="zr-audit__reason">« {e.reason} »</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------- Card, PageHeader, Chips
export function Card({ title, aside, children, flush }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className="zr-card" style={flush ? { overflow: "hidden" } : undefined}>
      {title && <div className="zr-card__head"><h2 className="zr-card__title">{title}</h2>{aside}</div>}
      {flush ? children : <div className="zr-card__body">{children}</div>}
    </section>
  );
}

export function Source({ children }: { children: ReactNode }) {
  return <span className="zr-src"><Info {...iconProps} size={13} />{children}</span>;
}

export function PageHeader({ title, subtitle, actions, breadcrumb }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; breadcrumb?: { label: string; href?: string }[] }) {
  return (
    <div className="zr-pagehead">
      <div>
        {breadcrumb && (
          <nav className="zr-crumb" aria-label="Fil d'Ariane">
            {breadcrumb.map((b, i) => (
              <span key={i} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                {i > 0 && <span aria-hidden="true">›</span>}
                {b.href ? <Link href={b.href}>{b.label}</Link> : <span aria-current="page">{b.label}</span>}
              </span>
            ))}
          </nav>
        )}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="zr-pagehead__actions">{actions}</div>}
    </div>
  );
}

export function ChipLink({ href, on, children }: { href: string; on: boolean; children: ReactNode }) {
  return <Link href={href} className={clsx("zr-chip", on && "is-on")} aria-current={on ? "true" : undefined} scroll={false}>{children}</Link>;
}

export function EmptyState({ title, text, action, error, requestId }: { title: string; text: string; action?: ReactNode; error?: boolean; requestId?: string }) {
  return (
    <div className={clsx("zr-table-state", error && "zr-table-state--error")} role={error ? "alert" : undefined}>
      <span className="zr-table-state__icon">{error ? <TriangleAlert {...iconProps} size={20} /> : <Info {...iconProps} size={20} />}</span>
      <h4>{title}</h4>
      <p>{text}</p>
      {requestId && <p>Identifiant de requête : <span className="zr-code">{requestId}</span></p>}
      {action}
    </div>
  );
}

export const srOnly: React.CSSProperties = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" };
