import { BrandLogo, LinkButton } from "@/components/ui";

export const metadata = { title: "Accès refusé" };

export default function Forbidden() {
  return (
    <main className="zr" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
      <div className="zr-card" style={{ maxWidth: 420, padding: 32, textAlign: "center", display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
        <BrandLogo variant="mark" size={40} />
        <h1 className="zira-title-section" style={{ margin: 0 }}>Accès refusé</h1>
        <p className="zr-muted" style={{ margin: 0 }}>Votre rôle ne permet pas d&apos;ouvrir cette page. Demandez l&apos;accès à un super_admin.</p>
        <LinkButton href="/" variant="primary">Retour au tableau de bord</LinkButton>
      </div>
    </main>
  );
}
