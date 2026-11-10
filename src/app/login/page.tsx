import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/ui";
import { LoginForm } from "./login-form";
import { getStaffSession } from "@/lib/auth/session";

export const metadata = { title: "Connexion" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getStaffSession()) redirect("/");
  return (
    <main className="zr" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16, background: "var(--zira-background)" }}>
      <div className="zr-card" style={{ width: "100%", maxWidth: 400, padding: 32, display: "flex", flexDirection: "column", gap: 24 }}>
        <BrandLogo size={40} subtitle="Backoffice" />
        <div>
          <h1 className="zira-title-page" style={{ margin: 0 }}>Connexion du personnel</h1>
          <p className="zr-muted" style={{ margin: "4px 0 0", fontSize: 14 }}>Accès réservé à l&apos;équipe Zira. Les comptes sont créés sur invitation, avec double authentification.</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
