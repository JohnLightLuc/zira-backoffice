"use client";

import { EyeOff, UserCheck, UserX } from "lucide-react";
import { ConfirmAction } from "@/components/client";
import { disableDevice, setClientAccess } from "@/lib/actions";

export function ClientAccessButton({ uid, name, meta, disabled }: { uid: string; name: string; meta: string; disabled: boolean }) {
  if (disabled) {
    return (
      <ConfirmAction
        trigger={{ label: "Réactiver le compte", variant: "primary", icon: UserCheck }}
        tone="warning"
        title="Réactiver le compte client"
        lead="Le client pourra de nouveau se connecter à l'application Zira."
        entityLabel={name} entityMeta={meta} entityId={uid}
        consequence="Firebase Auth repasse à disabled = false. L'abonnement et les données ne sont pas modifiés."
        confirmLabel="Réactiver le compte"
        run={(reason, idempotencyKey) => setClientAccess({ uid, disabled: false, reason, idempotencyKey })}
      />
    );
  }
  return (
    <ConfirmAction
      trigger={{ label: "Suspendre le compte", variant: "danger", icon: UserX }}
      title="Suspendre le compte client"
      lead="Le client ne pourra plus se connecter à l'application Zira."
      entityLabel={name} entityMeta={meta} entityId={uid}
      consequence="Firebase Auth passe à disabled = true. Ses sessions mobiles expirent sous 1 h. Données, véhicules et devices sont conservés."
      confirmLabel="Suspendre le compte"
      run={(reason, idempotencyKey) => setClientAccess({ uid, disabled: true, reason, idempotencyKey })}
    />
  );
}

export function DisableDeviceButton({ deviceId, ownerUid, name, meta }: { deviceId: string; ownerUid: string | null; name: string; meta: string }) {
  return (
    <ConfirmAction
      trigger={{ label: "Désactiver le device", variant: "secondary", icon: EyeOff }}
      tone="warning"
      title="Désactiver le device"
      lead="Opération Traccar passant par l'API d'administration Zira."
      entityLabel={name} entityMeta={meta} entityId={`Traccar ${deviceId}`}
      consequence="Le device passe à disabled = true dans Traccar : il n'enverra plus de positions. Le rattachement au véhicule est conservé."
      confirmLabel="Désactiver le device"
      run={(reason, idempotencyKey) => disableDevice({ deviceId, ownerUid, reason, idempotencyKey })}
    />
  );
}
