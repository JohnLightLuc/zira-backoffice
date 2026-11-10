import { PageHeader, EmptyState, LinkButton } from "@/components/ui";

/** Screens planned in the spec but not designed yet: honest placeholder, no fake data. */
export function Placeholder({ title, spec, needs }: { title: string; spec: string; needs: string }) {
  return (
    <>
      <PageHeader title={title} subtitle={`Spécification ${spec}`} />
      <div className="zr-card">
        <EmptyState title="Écran à construire" text={needs} action={<LinkButton href="/" variant="ghost" size="sm">Retour au tableau de bord</LinkButton>} />
      </div>
    </>
  );
}
