import { BrandLogo, LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="zr" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
      <div className="zr-card" style={{ maxWidth: 420, padding: 32, textAlign: "center", display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
        <BrandLogo variant="mark" size={40} />
        <h1 className="zira-title-section" style={{ margin: 0 }}>Introuvable</h1>
        <p className="zr-muted" style={{ margin: 0 }}>Cette page ou cet élément n&apos;existe pas, ou plus.</p>
        <LinkButton href="/">Retour au tableau de bord</LinkButton>
      </div>
    </main>
  );
}
