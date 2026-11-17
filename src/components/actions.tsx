"use client";

import { Eye, EyeOff, UserCheck, UserX } from "lucide-react";
import { ConfirmAction } from "@/components/client";
import { setClientAccess, setDeviceDisabled } from "@/lib/actions";

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
      consequence="Firebase Auth passe à disabled = true et toutes ses sessions sont révoquées immédiatement. Données, véhicules et devices sont conservés."
      confirmLabel="Suspendre le compte"
      run={(reason, idempotencyKey) => setClientAccess({ uid, disabled: true, reason, idempotencyKey })}
    />
  );
}

/**
 * Staff account suspension: same route as clients (PATCH /admin/v1/clients/:uid/access), which only
 * a super_admin may use on a staff account (§3, note 1). Never offered on one's own account (400).
 */
export function StaffAccessButton({ uid, label, role, disabled }: { uid: string; label: string; role: string; disabled: boolean }) {
  if (disabled) {
    return (
      <ConfirmAction
        trigger={{ label: "Réactiver", variant: "secondary", icon: UserCheck }}
        tone="warning"
        title="Réactiver le compte staff"
        lead="La personne pourra de nouveau se connecter au backoffice."
        entityLabel={label} entityMeta={`Rôle ${role}`} entityId={uid}
        consequence="Firebase Auth repasse à disabled = false. Le rôle staff n'est pas modifié ; la MFA reste exigée à la connexion."
        confirmLabel="Réactiver le compte"
        run={(reason, idempotencyKey) => setClientAccess({ uid, disabled: false, reason, idempotencyKey })}
      />
    );
  }
  return (
    <ConfirmAction
      trigger={{ label: "Suspendre", variant: "danger", icon: UserX }}
      title="Suspendre le compte staff"
      lead="Blocage immédiat de l'accès au backoffice (et à l'application si le compte est aussi client)."
      entityLabel={label} entityMeta={`Rôle ${role}`} entityId={uid}
      consequence="Firebase Auth passe à disabled = true et toutes ses sessions sont révoquées : la personne reçoit des 401 et est déconnectée. Le rôle staff est conservé pour une éventuelle réactivation ; pour retirer l'accès définitivement, utiliser « Modifier » → Retirer l'accès."
      confirmLabel="Suspendre le compte"
      run={(reason, idempotencyKey) => setClientAccess({ uid, disabled: true, reason, idempotencyKey })}
    />
  );
}

export function DeviceDisabledButton({ deviceId, ownerUid, name, meta, disabled }: { deviceId: string; ownerUid: string | null; name: string; meta: string; disabled: boolean }) {
  if (disabled) {
    return (
      <ConfirmAction
        trigger={{ label: "Réactiver le device", variant: "primary", icon: Eye }}
        tone="warning"
        title="Réactiver le device"
        lead="Opération Traccar passant par l'API d'administration Zira."
        entityLabel={name} entityMeta={meta} entityId={`Traccar ${deviceId}`}
        consequence="Le device repasse à disabled = false dans Traccar et peut de nouveau envoyer des positions."
        confirmLabel="Réactiver le device"
        run={(reason, idempotencyKey) => setDeviceDisabled({ deviceId, ownerUid, disabled: false, reason, idempotencyKey })}
      />
    );
  }
  return (
    <ConfirmAction
      trigger={{ label: "Désactiver le device", variant: "secondary", icon: EyeOff }}
      tone="warning"
      title="Désactiver le device"
      lead="Opération Traccar passant par l'API d'administration Zira."
      entityLabel={name} entityMeta={meta} entityId={`Traccar ${deviceId}`}
      consequence="Le device passe à disabled = true dans Traccar : il n'enverra plus de positions. Le rattachement au véhicule est conservé."
      confirmLabel="Désactiver le device"
      run={(reason, idempotencyKey) => setDeviceDisabled({ deviceId, ownerUid, disabled: true, reason, idempotencyKey })}
    />
  );
}
