import type { ReactNode } from "react";
import clsx from "clsx";
import { BrandLogo, EnvBadge } from "@/components/ui";
import { LogoutButton, NavLinks, SearchField } from "@/components/client";
import { can } from "@/lib/auth/rbac";
import type { StaffSession } from "@/lib/auth/session";

/** Page frame: sidebar on --zira-primary, header with global search, environment and profile (spec §4). */
export function AppShell({ staff, env, counts, children }: { staff: StaffSession; env: "production" | "staging" | "development"; counts: Record<string, number>; children: ReactNode }) {
  const hidden = [!can(staff.role, "audit:read") && "audit", !can(staff.role, "health:read") && "health"].filter(Boolean) as string[];
  return (
    <div className={clsx("zr zr-shell", env === "production" && "zr-shell--prod")}>
      <a href="#contenu" className="skip-link">Aller au contenu</a>
      <aside className="zr-side">
        <div className="zr-side__brand"><BrandLogo tone="white" size={34} subtitle="Backoffice" /></div>
        <NavLinks hidden={hidden} counts={counts} />
        <div className="zr-side__foot">
          <span className="zr-avatar" aria-hidden="true">{staff.initials}</span>
          <div className="zr-side__who"><b>{staff.name}</b><span>{staff.role}</span></div>
          <LogoutButton demo={staff.demo} />
        </div>
      </aside>
      <div className="zr-main">
        <header className="zr-top">
          <SearchField global basePath="/clients" placeholder="Rechercher un client : nom, e-mail, téléphone, UID…" label="Recherche globale" />
          <div className="zr-top__right">
            {staff.demo && <span className="demo-pill">Données de démonstration</span>}
            <EnvBadge env={env} />
          </div>
        </header>
        <main id="contenu" className="zr-content">{children}</main>
      </div>
    </div>
  );
}
