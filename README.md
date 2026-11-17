# Zira Backoffice

Outil web interne de l'équipe Zira : supervision multi-client des comptes, abonnements, devices Traccar, documents et paiements, avec actions de support tracées. Réalisé d'après `BACKOFFICE_SPEC.md` et le design system « Zira Backoffice ».

**Stack** : Next.js 16 (App Router, Server Components, Server Actions) · TypeScript strict · Tailwind 3 + variables `--zira-*` · Firebase Admin (serveur) · Firebase Auth Web (connexion staff uniquement) · Zod · Lucide · Vitest.

## Démarrer en 2 minutes (mode démo)

```bash
npm install
cp .env.example .env.local      # ZIRA_DEMO_MODE=true par défaut
npm run dev                     # http://localhost:3000
```

Le mode démo sert des données fictives anonymisées, sans Firebase ni connexion. Le rôle simulé se change avec `ZIRA_DEMO_ROLE` (`super_admin`, `support`, `billing`, `viewer`). Il est **refusé au démarrage** si `NEXT_PUBLIC_ZIRA_ENV=production`.

```bash
npm test          # matrice RBAC §3, transport /admin/v1, schémas, contrat de bout en bout, mappers
npm run typecheck
npm run build
```

## Ce qui est livré

| Écran | Route | Données |
|---|---|---|
| Tableau de bord (7.1) | `/` `?period=day\|week\|month\|custom` | agrégats Firestore `count()` / `sum()` + stats devices via API admin |
| Clients (7.2) | `/clients` `?q=&plan=&sub=&sort=&dir=&cursor=` | projection `admin_client_index` |
| Fiche client (7.2) | `/clients/[uid]` `?tab=fleet\|history` | `users`, `subscriptions`, Auth, compteurs par `ownerId`, audit |
| Parc & GPS (7.4) | `/devices` `?status=&clientId=&cursor=&device=` | API admin Zira (Traccar) |
| Export CSV | `/api/clients/export` | rôles `billing`, `super_admin`, audité |
| Connexion | `/login` → `/api/session` | Firebase Auth + MFA → cookie HttpOnly |
| Personnel (`/staff`) | API admin | `GET/POST /admin/v1/staff`, `PATCH /admin/v1/staff/:uid`, suspension via `PATCH /admin/v1/clients/:uid/access` — `super_admin` uniquement |
| Santé (`/health`), Journal d'audit (`/audit`) | API admin | `GET /admin/v1/health`, `GET /admin/v1/audit-logs` (filtres, curseur) |
| Abonnements (`/subscriptions`) `?status=&plan=&dir=&cursor=` | `subscriptions` (Admin SDK) + `plans` + audit | ajustement via `POST /admin/v1/subscriptions/:uid/adjustments` |
| Activité, Documents | pages d'attente | prérequis listés sur chaque page |

Actions sensibles (Server Actions, `src/lib/actions.ts`, formulaires dans `src/components/forms.tsx`) : suspendre / réactiver un compte, ajouter une note, ajuster un abonnement, modifier / désactiver / réactiver / rattacher un device, gérer le staff. Chacune valide l'entrée (schémas alignés sur les DTO backend), revérifie le rôle pour un message clair, exige un motif (5 à 500 caractères) et une `Idempotency-Key` par intention, puis appelle `/admin/v1`. **L'audit est écrit par le backend** (succès et échec) ; `changed: false` s'affiche « Aucun changement ».

## Architecture

```
src/
  app/(admin)/…          pages protégées (layout = requireStaff)
  app/api/session        échange ID token → cookie de session (MFA, claim staffRole, CSRF)
  app/api/clients/export export CSV audité
  proxy.ts               redirection /login sans cookie (confort, pas une frontière de sécurité)
  components/ui.tsx      composants du design system (serveur)
  components/client.tsx  navigation, recherche, filtre de période, dialogue de confirmation
  lib/auth/              rôles, permissions, session staff
  lib/data/              fonctions serveur typées : getClientsPage, getClientOverview, getDashboard, getDevicesPage…
  lib/admin-api/         contrat /admin/v1 (BACKOFFICE_API.md) : types, schémas Zod, transport,
                         client serveur, implémentation mémoire du contrat pour le mode démo
  lib/actions.ts         mutations sensibles (Server Actions)
  components/session-sync.tsx  rafraîchit le cookie __session (ID token) via onIdTokenChanged
  styles/tokens.css      tokens --zira-* (générés depuis le design system)
```

Principes appliqués : Admin SDK uniquement côté serveur (`server-only`), aucune lecture Firestore ni appel Traccar depuis le navigateur, refus par défaut (`can()`), permissions décidées par le serveur et passées à l'UI, champs secrets jamais lus ni renvoyés (`traccarPassword`, `fcmToken`, tokens), filtres dans l'URL, pagination par curseur sans total inventé, en-têtes de sécurité et CSP (`next.config.ts`).

## Passer sur les vraies données

1. **Firebase Admin** : renseigner `FIREBASE_PROJECT_ID` et utiliser les identifiants par défaut de l'environnement (Cloud Run + compte de service), ou `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` depuis Secret Manager. Passer `ZIRA_DEMO_MODE=false`.
2. **Comptes du personnel** : inscrire le second facteur (SMS) puis `npx tsx scripts/set-staff-role.ts agent@zira.ci support`.
3. **Projection clients** : `npx tsx scripts/backfill-client-index.ts --write`, puis la maintenir par des triggers dans `functions/` (écriture sur `users`, `subscriptions`, `vehicles`). `listUsers` n'étant pas un moteur de recherche (spec §8), la liste, la recherche et le tableau de bord lisent cette projection.
4. **Index et règles** : `firebase deploy --only firestore:indexes` avec `firestore.indexes.json`. Fusionner `firestore.rules.backoffice.md` dans les règles. Une combinaison filtre + tri sans index renvoie une erreur Firestore avec le lien de création.
5. **API d'administration** : renseigner `ADMIN_API_URL` (`http://localhost:3000` en local, `https://api.zira.ci` en production). Les appels portent l'ID token Firebase du membre du personnel : le projet Firebase doit être le même que celui du backend.

### Intégration de l'API d'administration (`BACKOFFICE_API.md`)

- **Session** : le backend n'accepte qu'un **ID token** Firebase (1 h). Le cookie HttpOnly `__session` contient donc l'ID token courant ; le SDK Web reste connecté et `<SessionSync>` re-poste chaque nouveau token à `POST /api/session` (vérification `checkRevoked`, claim `staffRole`, MFA). Un 401 de l'API redirige vers `/login?reason=session_revoked`.
- **Transport** (`lib/admin-api/core.ts`) : `Authorization: Bearer`, `X-Request-Id` par appel, `Idempotency-Key` sur les mutations, `cache: 'no-store'`, timeout 20 s, déballage de l'enveloppe `{success, message, data}` ; les erreurs portent le statut HTTP (pas de code machine) et le `requestId`.
- **Lectures via l'API** : devices (+ véhicules orphelins), détail et positions 24 h, notes client, journal d'audit, santé. Les compteurs du parc parcourent toutes les pages de `GET /devices` (cache partagé 60 s, invalidé après chaque mutation de device).
- **Lectures Admin SDK** inchangées : clients, abonnements, compteurs, véhicules (projections sans `traccarPassword` / `fcmToken`).
- **Mode démo** : une implémentation mémoire du contrat (`lib/admin-api/demo-backend.ts`) applique les mêmes règles (rôles, liste blanche, motif, `changed: false`, idempotence 409/422, 404/409 de rattachement), si bien que le mode démo et les tests passent par le même code que la production.
- **Index Firestore** : `firestore.indexes.json` contient les index `admin_audit_logs (filtre + createdAt desc)` et `admin_client_notes (clientId, createdAt desc)` attendus par le backend.

## Points de sécurité à traiter avant la production (spec §9)

- `activateSubscription` lit `uid` dans le payload : imposer `uid === request.auth.uid` pour les clients.
- Les fonctions HTTP `*Now` et `runSubscriptionMigration` n'ont pas de garde d'authentification visible.
- `traccarPassword` dans `UserModel` : jamais lu par ce backoffice ; planifier sa suppression.
- Journal d'audit append-only : compte de service limité à la création, ou export Cloud Logging verrouillé.
- `npm audit` signale un avertissement modéré sur `glob` (dépendance de nettoyage interne à firebase-admin, non exécutée au runtime) ; `@grpc/grpc-js` est forcé en 1.14.6 via `overrides`.

## Reste à faire

Activité métier, Documents (liens temporaires signés côté serveur), Santé système (Cloud Logging / Monitoring), Journal d'audit paginé ; réconciliation RevenueCat avant tout chiffre financier ; flux temps réel staff si le backend l'ouvre.
