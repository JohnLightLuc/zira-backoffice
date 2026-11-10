"use client";

import { Alert, Button } from "@/components/ui";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Alert tone="danger" title="Une erreur est survenue" action={<Button size="sm" onClick={reset}>Réessayer</Button>}>
      Le chargement a échoué. {error.digest && <>Référence : <span className="zr-code">{error.digest}</span></>}
    </Alert>
  );
}
