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
npm test          # RBAC, masquage des secrets, pagination complète, filtres devices
npm run typecheck
npm run build
```

## Ce qui est livré

| Écran | Route | Données |
|---|---|---|
| Tableau de bord (7.1) | `/` `?period=day\|week\|month\|custom` | agrégats Firestore `count()` / `sum()` + stats devices via API admin |
| Clients (7.2) | `/clients` `?q=&plan=&sub=&sort=&dir=&cursor=` | projection `admin_client_index` |
| Fiche client (7.2) | `/clients/[uid]` `?tab=fleet\|history` | `users`, `subscriptions`, Auth, compteurs par `ownerId`, audit |
| Parc & GPS (7.4) | `/devices` `?status=&q=&device=` | API admin Zira (Traccar) |
| Export CSV | `/api/clients/export` | rôles `billing`, `super_admin`, audité |
| Connexion | `/login` → `/api/session` | Firebase Auth + MFA → cookie HttpOnly |
| Abonnements, Activité, Documents, Santé, Audit | pages d'attente | prérequis listés sur chaque page |

Actions sensibles (Server Actions, `src/lib/actions.ts`) : **suspendre / réactiver un compte**, **désactiver un device**. Chacune valide l'entrée, revérifie le rôle côté serveur, exige un motif (≥ 10 caractères) et une clé d'idempotence, passe par l'API admin et écrit une entrée d'audit en cas de succès **et** d'échec.

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
  lib/admin-api.ts       client typé des routes /admin/v1 (à créer côté backend)
  lib/actions.ts         mutations sensibles
  styles/tokens.css      tokens --zira-* (générés depuis le design system)
```

Principes appliqués : Admin SDK uniquement côté serveur (`server-only`), aucune lecture Firestore ni appel Traccar depuis le navigateur, refus par défaut (`can()`), permissions décidées par le serveur et passées à l'UI, champs secrets jamais lus ni renvoyés (`traccarPassword`, `fcmToken`, tokens), filtres dans l'URL, pagination par curseur sans total inventé, en-têtes de sécurité et CSP (`next.config.ts`).

## Passer sur les vraies données

1. **Firebase Admin** : renseigner `FIREBASE_PROJECT_ID` et utiliser les identifiants par défaut de l'environnement (Cloud Run + compte de service), ou `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` depuis Secret Manager. Passer `ZIRA_DEMO_MODE=false`.
2. **Comptes du personnel** : inscrire le second facteur (SMS) puis `npx tsx scripts/set-staff-role.ts agent@zira.ci support`.
3. **Projection clients** : `npx tsx scripts/backfill-client-index.ts --write`, puis la maintenir par des triggers dans `functions/` (écriture sur `users`, `subscriptions`, `vehicles`). `listUsers` n'étant pas un moteur de recherche (spec §8), la liste, la recherche et le tableau de bord lisent cette projection.
4. **Index et règles** : `firebase deploy --only firestore:indexes` avec `firestore.indexes.json`. Fusionner `firestore.rules.backoffice.md` dans les règles. Une combinaison filtre + tri sans index renvoie une erreur Firestore avec le lien de création.
5. **API d'administration** : renseigner `ZIRA_ADMIN_API_URL` et `ZIRA_ADMIN_API_TOKEN`.

### Prérequis backend (routes proposées, à créer — spec §8)

Aucune de ces routes n'existe aujourd'hui. Sans elles, le parc affiche « Source Traccar non connectée » et les actions répondent « API d'administration non branchée » : rien n'est simulé hors mode démo.

| Méthode / route | Utilisée par |
|---|---|
| `GET /admin/v1/devices?status=&q=&clientId=&staleMinutes=&cursor=` | Parc, fiche client |
| `GET /admin/v1/devices/stats?staleMinutes=` | Tableau de bord, Parc |
| `GET /admin/v1/devices/{id}` · `GET /admin/v1/devices/{id}/positions?from=&to=` | Détail device (fenêtre 24 h) |
| `POST /admin/v1/devices/{id}/disable` `{reason}` | Désactivation |
| `PATCH /admin/v1/clients/{uid}/access` `{disabled, reason}` | Suspension / réactivation |

Contrat attendu : JSON, erreurs `{code, message, requestId}`, dates ISO-8601 UTC, pages `{items, nextCursor, hasMore}`. Le backoffice envoie `x-request-id`, `idempotency-key`, `x-staff-uid` et `x-staff-role` : le backend doit **revérifier** le rôle et ne jamais faire confiance au seul en-tête (authentifier l'appel serveur par jeton de service ou IAM).

## Points de sécurité à traiter avant la production (spec §9)

- `activateSubscription` lit `uid` dans le payload : imposer `uid === request.auth.uid` pour les clients.
- Les fonctions HTTP `*Now` et `runSubscriptionMigration` n'ont pas de garde d'authentification visible.
- `traccarPassword` dans `UserModel` : jamais lu par ce backoffice ; planifier sa suppression.
- Journal d'audit append-only : compte de service limité à la création, ou export Cloud Logging verrouillé.
- `npm audit` signale un avertissement modéré sur `glob` (dépendance de nettoyage interne à firebase-admin, non exécutée au runtime) ; `@grpc/grpc-js` est forcé en 1.14.6 via `overrides`.

## Reste à faire

Écrans Abonnements (ajustement via `POST /admin/v1/subscriptions/{uid}/adjustments`), Activité métier, Documents (liens temporaires signés côté serveur), Santé système (Cloud Logging / Monitoring), Journal d'audit paginé ; réconciliation RevenueCat avant tout chiffre financier ; flux temps réel staff si le backend l'ouvre.
