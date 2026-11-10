# Backoffice Zira — guide d'intégration API (Next.js)

> Document destiné à l'équipe (ou à l'IA) qui construit le backoffice **Next.js App Router + TypeScript**.
> Il décrit le fonctionnement de l'API d'administration `/admin/v1/*` exposée par `fleet_backend` (NestJS), les contrats exacts de chaque route, et la manière de les consommer côté Next.js.
>
> Source de vérité : le code de la branche `feat/backoffice-api` (contrôleurs `src/infrastructure/controllers/admin-*.ts`, DTO `src/core/application/dtos/admin-*.ts`, services `src/core/application/services/admin-*.ts`).
> Documents liés : `docs/BACKOFFICE_SPEC.md` (cahier des charges fonctionnel et UI), `docs/BACKOFFICE_PLAN.md` (avancement backend).
> Dernière mise à jour : 2026-11-10.

---

## Sommaire

1. [Architecture et répartition des responsabilités](#1-architecture-et-répartition-des-responsabilités)
2. [Authentification et session staff](#2-authentification-et-session-staff)
3. [Rôles et matrice des permissions](#3-rôles-et-matrice-des-permissions)
4. [Conventions communes](#4-conventions-communes)
5. [Contrats des routes](#5-contrats-des-routes)
6. [Lectures Firebase directes (sans route NestJS)](#6-lectures-firebase-directes-sans-route-nestjs)
7. [Implémentation côté Next.js](#7-implémentation-côté-nextjs)
8. [Correspondance écrans → données](#8-correspondance-écrans--données)
9. [Limites connues et prérequis](#9-limites-connues-et-prérequis)
10. [Checklist d'intégration](#10-checklist-dintégration)

---

## 1. Architecture et répartition des responsabilités

```
┌──────────────┐  Firebase Web SDK (login, ID token)
│  Navigateur  │──────────────────────────────────────► Firebase Auth
│  (React)     │
└──────┬───────┘
       │ cookie HttpOnly "__session" (ID token)
       ▼
┌────────────────────────────────────────────┐
│  Serveur Next.js (Server Components,       │
│  Server Actions, Route Handlers)           │
│                                            │
│  • Lectures : Firebase Admin SDK ──────────┼──► Firestore / Auth (lecture globale)
│  • Mutations + Traccar : fetch ────────────┼──► API Zira  /admin/v1/*  (NestJS)
└────────────────────────────────────────────┘                │
                                                              ├──► Firebase Admin (Auth, Firestore)
                                                              ├──► Traccar (identifiants admin)
                                                              └──► Redis (idempotence, rate limit)
```

| Besoin | Où | Pourquoi |
|---|---|---|
| Lister/consulter clients, abonnements, plans, véhicules, chauffeurs, affectations, documents, `payment_logs`, notifications | **Serveur Next.js via Admin SDK** | Lecture simple, pas de règle métier ; pas de route NestJS dédiée (voir §6). |
| Inventaire et détail des **devices Traccar**, positions | **API `/admin/v1/devices*`** | Les identifiants admin Traccar ne vivent que dans le backend. |
| **Toute mutation** (suspension, abonnement, device, staff, notes) | **API `/admin/v1/*`** | RBAC, motif obligatoire, audit `admin_audit_logs`, idempotence. |
| Journal d'audit, notes client | **API `/admin/v1/*`** | Masquage, pagination et contrôle de rôle centralisés. |
| Santé (Firestore, Redis, Traccar) | **API `/admin/v1/health`** | Vérifie les dépendances du backend lui-même. |

**Règles non négociables**

- Le navigateur **n'appelle jamais** l'API admin ni Firestore Admin directement : tout passe par le serveur Next.js (`import 'server-only'`).
- Le frontend **n'est pas une frontière de sécurité** : masquer un bouton selon le rôle est du confort, le backend refuse de toute façon (403).
- Aucun secret (compte de service Firebase, clé Traccar) dans une variable `NEXT_PUBLIC_*`.

---

## 2. Authentification et session staff

### 2.1 Ce qu'attend le backend

Chaque requête `/admin/v1/*` doit porter :

```
Authorization: Bearer <Firebase ID token>
```

Le guard `StaffAuthGuard` :

1. vérifie le token avec `verifyIdToken(token, checkRevoked = true)` → un compte suspendu ou dont le rôle a changé est rejeté immédiatement (**401**) ;
2. lit le custom claim **`staffRole`** ∈ `super_admin | support | billing | viewer`, sinon **403** « Accès réservé au personnel Zira » ;
3. contrôle le rôle exigé par la route, sinon **403** « Rôle insuffisant pour cette action » ;
4. renvoie un header **`X-Request-Id`** (celui fourni par le client s'il respecte `^[\w-]{8,64}$`, sinon un UUID généré).

> ⚠️ Le backend accepte un **ID token** (durée 1 h), pas un session cookie Firebase (`createSessionCookie`). La session Next.js doit donc conserver l'ID token courant (voir 2.2).

### 2.2 Flux recommandé côté Next.js

1. **Login** (`/login`, Client Component) : `signInWithEmailAndPassword` (Firebase Web SDK). MFA staff recommandée (TOTP/SMS Firebase).
2. **Synchronisation du cookie** : `onIdTokenChanged(auth, user => …)` envoie le token à un Route Handler `POST /api/session` qui pose un cookie `__session` (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, `Max-Age=3600`). Le SDK rafraîchit le token avant expiration ; le callback re-pose le cookie. À la déconnexion : `DELETE /api/session`.
3. **Middleware** (`middleware.ts`) : redirige vers `/login` si le cookie est absent (contrôle léger, pas de vérification cryptographique en edge).
4. **Côté serveur** (layout protégé, Server Actions, Route Handlers) : `getStaffSession()` lit le cookie, fait `adminAuth.verifyIdToken(token, true)`, vérifie le claim `staffRole`, et renvoie `{ uid, email, role, token }`. Sinon `redirect('/login')`.
5. **Appels API** : le `token` de la session est transmis en `Authorization: Bearer`.

```ts
// app/api/session/route.ts
import { cookies } from 'next/headers';
import { adminAuth } from '@/lib/firebase-admin';

export async function POST(req: Request) {
  const { idToken } = (await req.json()) as { idToken?: string };
  if (!idToken) return new Response(null, { status: 400 });
  const decoded = await adminAuth.verifyIdToken(idToken, true).catch(() => null);
  if (!decoded?.staffRole) return new Response(null, { status: 403 }); // pas de session pour un non-staff
  (await cookies()).set('__session', idToken, {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 * 60,
  });
  return new Response(null, { status: 204 });
}

export async function DELETE() {
  (await cookies()).delete('__session');
  return new Response(null, { status: 204 });
}
```

```ts
// lib/auth/session.ts
import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { adminAuth } from '@/lib/firebase-admin';
import type { StaffRole } from '@/lib/admin-api/types';

export interface StaffSession { uid: string; email: string | null; role: StaffRole; token: string }

const ROLES = ['super_admin', 'support', 'billing', 'viewer'] as const;

export async function getStaffSession(): Promise<StaffSession> {
  const token = (await cookies()).get('__session')?.value;
  if (!token) redirect('/login');
  const decoded = await adminAuth.verifyIdToken(token, true).catch(() => null);
  const role = decoded?.staffRole as StaffRole | undefined;
  if (!decoded || !role || !ROLES.includes(role)) redirect('/login?reason=forbidden');
  return { uid: decoded.uid, email: decoded.email ?? null, role, token };
}
```

> Après un changement de rôle (`PATCH /admin/v1/staff/:uid`) ou une suspension, les refresh tokens du compte sont **révoqués** : l'utilisateur concerné reçoit des 401 et doit se reconnecter. Prévoir ce cas (redirection `/login?reason=session_revoked`).

### 2.3 Provisionnement des comptes staff

- Le **premier** `super_admin` se crée en ligne de commande côté backend :
  `node --env-file=.env -r ts-node/register scripts/set-staff-role.ts <email> super_admin`
- Ensuite, depuis le backoffice : `POST /admin/v1/staff` (le compte Firebase Auth doit déjà exister ; aucune création de compte ni inscription publique).

---

## 3. Rôles et matrice des permissions

| Route | `super_admin` | `support` | `billing` | `viewer` |
|---|:-:|:-:|:-:|:-:|
| `GET /admin/v1/health` | ✅ | ✅ | ✅ | ✅ |
| `GET /admin/v1/devices` | ✅ | ✅ | ✅ | ✅ |
| `GET /admin/v1/devices/:deviceId` | ✅ | ✅ | ✅ | ✅ |
| `GET /admin/v1/devices/:deviceId/positions` | ✅ | ✅ | ✅ | ✅ |
| `PATCH /admin/v1/devices/:deviceId` | ✅ | ✅ | ❌ | ❌ |
| `POST /admin/v1/devices/:deviceId/disable` | ✅ | ✅ | ❌ | ❌ |
| `POST /admin/v1/devices/:deviceId/enable` | ✅ | ✅ | ❌ | ❌ |
| `POST /admin/v1/devices/:deviceId/link` | ✅ | ✅ | ❌ | ❌ |
| `PATCH /admin/v1/clients/:uid/access` | ✅ | ✅ ¹ | ❌ | ❌ |
| `GET /admin/v1/clients/:uid/notes` | ✅ | ✅ | ✅ | ❌ |
| `POST /admin/v1/clients/:uid/notes` | ✅ | ✅ | ❌ | ❌ |
| `POST /admin/v1/subscriptions/:uid/adjustments` | ✅ | ❌ | ✅ | ❌ |
| `GET /admin/v1/audit-logs` | ✅ | ✅ | ✅ | ❌ |
| `GET /admin/v1/staff` | ✅ | ❌ | ❌ | ❌ |
| `POST /admin/v1/staff` | ✅ | ❌ | ❌ | ❌ |
| `PATCH /admin/v1/staff/:uid` | ✅ | ❌ | ❌ | ❌ |

¹ `support` ne peut pas suspendre/réactiver un **compte staff** (403) ; personne ne peut modifier **son propre** accès (400).

Pour l'UI, reproduire cette matrice dans un module unique (`lib/auth/permissions.ts`) — voir §7.6.

---

## 4. Conventions communes

### 4.1 Base URL et environnements

| Environnement | `ADMIN_API_URL` |
|---|---|
| Local | `http://localhost:3000` |
| Production | `https://api.zira.ci` |

Toutes les routes sont préfixées par `/admin/v1`. Afficher l'environnement courant dans l'en-tête du backoffice (bandeau coloré hors production).

### 4.2 Enveloppe de réponse

Toutes les réponses (succès **et** erreurs) sont enveloppées par `ResponseInterceptor` / `HttpExceptionFilter` :

```ts
interface ApiEnvelope<T> {
  success: boolean;
  message: string;   // "Succès" en cas de succès ; message d'erreur lisible (FR) sinon
  data: T | null;    // null en cas d'erreur
}
```

Succès :

```json
{ "success": true, "message": "Succès", "data": { "uid": "abc", "disabled": true, "changed": true } }
```

Erreur :

```json
{ "success": false, "message": "Rôle insuffisant pour cette action", "data": null }
```

> Il n'y a **pas** de champ `code` machine dans les erreurs : se baser sur le **statut HTTP** pour la logique, et afficher `message` à l'opérateur. Les erreurs de validation multiples sont concaténées par `", "` dans `message`.

### 4.3 Codes HTTP

| Statut | Signification dans l'API admin | Conduite côté UI |
|---|---|---|
| 200 / 201 | Succès (201 sur `POST /staff`, `POST /clients/:uid/notes`, `POST /subscriptions/:uid/adjustments`) | Traiter les deux comme succès. |
| 400 | Validation DTO, motif manquant/trop court, règle métier (ex. fenêtre > 7 jours, abonnement incohérent, action sur soi-même), `Idempotency-Key` mal formée | Afficher `message` sous le formulaire. |
| 401 | Token absent, invalide, expiré ou **révoqué** | Rafraîchir le token une fois, puis rediriger vers `/login`. |
| 403 | Compte non staff, ou rôle insuffisant | Page/notice « Accès refusé ». Ne pas réessayer. |
| 404 | Client, abonnement, device, véhicule ou plan introuvable | État « introuvable ». |
| 409 | Conflit : rattachement existant, compte déjà staff, requête idempotente en cours | Afficher `message` ; ne pas réessayer automatiquement. |
| 422 | `Idempotency-Key` réutilisée avec un **corps différent** | Bug client : générer une nouvelle clé par intention. |
| 429 | Rate limit global (`THROTTLE_LIMIT` = 100 req / 60 s par défaut) | Backoff, message « Trop de requêtes ». |
| 502 | Traccar en erreur (`Traccar indisponible : …`) | Bannière « GPS indisponible », bouton réessayer. |
| 504 | Traccar ne répond pas (timeout) | Idem 502. |
| 500 | Erreur interne | Message générique + `X-Request-Id` à communiquer. |

### 4.4 Dates

- Toutes les dates sont en **ISO-8601 UTC** (`2026-11-10T08:30:00.000Z`) en entrée comme en sortie.
- Les paramètres de date (`staleBefore`, `from`, `to`, `endDate`) doivent passer `IsISO8601`. Convertir les dates saisies en heure locale (Africa/Abidjan = UTC) avec `toISOString()`.

### 4.5 Pagination par curseur

Les listes paginées renvoient :

```ts
interface CursorPage<T> {
  items: T[];
  nextCursor: string | null; // à renvoyer tel quel dans ?cursor= pour la page suivante
  hasMore: boolean;
}
```

- `limit` : entier 1–100, défaut **50**.
- Le curseur est **opaque** côté UI (ID Firestore pour notes/audit, ID Traccar numérique pour devices). Ne pas le construire à la main.
- Pagination « Suivant » uniquement (pas de page N ni de total). Pour un « Précédent », conserver la pile des curseurs déjà visités dans l'état (ou l'URL).
- Un curseur inconnu → **400** « Curseur invalide ».

### 4.6 Validation stricte

Le backend utilise `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` : **tout champ non prévu dans le body ou la query provoque un 400**. N'envoyer que les champs documentés ; ne pas envoyer `undefined` sérialisé en `null` sur les champs optionnels (sauf `role: null` pour le staff).

### 4.7 Mutations : motif, audit, no-op

- Toutes les mutations (sauf les notes) exigent **`reason`** : chaîne de **5 à 500 caractères**. Le formulaire doit l'imposer (champ obligatoire dans la boîte de confirmation).
- Chaque mutation effective écrit une entrée dans `admin_audit_logs` (succès **et** échec) avec acteur, rôle, cible, motif, `requestId`, état avant/après (secrets masqués).
- Si l'état demandé est **déjà atteint**, la réponse contient `changed: false` et **aucune entrée d'audit** n'est créée. L'UI doit afficher « Aucun changement » plutôt que « Modifié ».

### 4.8 Idempotence (`Idempotency-Key`)

Toutes les mutations acceptent le header optionnel :

```
Idempotency-Key: <8 à 128 caractères [A-Za-z0-9_-]>
```

- Portée de la clé : **staff + méthode + chemin + clé**, conservée 24 h dans Redis.
- Même clé + même corps, requête terminée → la **réponse d'origine est rejouée** (aucun nouvel effet).
- Même clé, requête encore en cours → **409**.
- Même clé + corps différent → **422**.
- Si la mutation échoue, la clé est libérée : on peut réessayer avec la même clé.

**Règle UI** : générer **une clé par intention utilisateur** (`crypto.randomUUID()` à l'ouverture de la boîte de confirmation), la réutiliser pour les retries réseau de cette même action, et en générer une nouvelle si l'opérateur modifie le formulaire.

### 4.9 `X-Request-Id`

- Optionnel en entrée (`^[\w-]{8,64}$`), sinon généré. Renvoyé en header de réponse **une fois l'authentification passée** (absent des 401/403 du guard).
- Le transmettre depuis Next.js (UUID par requête) et l'afficher dans les toasts d'erreur pour faciliter le support ; il est aussi stocké dans l'audit (`requestId`).

### 4.10 Données jamais renvoyées

`traccarPassword`, `fcmToken`, tokens, mots de passe, secrets et URL signées ne sont jamais renvoyés par l'API admin. Les lectures Admin SDK côté Next.js doivent appliquer la même règle (projections explicites, voir §6).

---

## 5. Contrats des routes

Les types TypeScript ci-dessous décrivent `data` (le contenu de l'enveloppe). Ils sont regroupés en §7.2 pour copie dans `lib/admin-api/types.ts`.

### 5.1 Santé

#### `GET /admin/v1/health` — tout staff

Vérifie Firestore, Redis et Traccar (`/api/server`) en parallèle.

```ts
interface DependencyCheck { status: 'up' | 'down'; latencyMs: number; error?: string }
interface HealthReport {
  status: 'ok' | 'degraded';           // 'degraded' si une dépendance est 'down'
  checkedAt: string;                    // ISO
  checks: { firestore: DependencyCheck; redis: DependencyCheck; traccar: DependencyCheck };
}
```

Toujours **200**, même dégradé : lire `data.status`. Rafraîchir toutes les 30–60 s maximum.

---

### 5.2 Devices Traccar

#### `GET /admin/v1/devices` — tout staff

Inventaire multi-clients des devices Traccar, enrichi par Firestore (`vehicles`, `users`).

**Query**

| Paramètre | Type | Description |
|---|---|---|
| `clientId` | string | UID Firebase du client : ne liste que les devices de son compte Traccar. 404 si client inconnu. |
| `status` | `online` \| `offline` \| `unknown` | Statut Traccar. |
| `staleBefore` | ISO date | Devices dont le dernier signal est **antérieur** à cette date, **ou jamais vus**. |
| `neverSeen` | `true` \| `false` | `true` : `lastUpdate` nul. |
| `disabled` | `true` \| `false` | État désactivé Traccar. |
| `unlinked` | `true` \| `false` | `true` : aucun véhicule Firestore rattaché. |
| `cursor` | string numérique | `nextCursor` précédent. |
| `limit` | 1–100 | Défaut 50. |

Tri : par `id` Traccar croissant.

**Réponse `data`**

```ts
type DeviceIssue =
  | 'NO_VEHICLE'                    // aucun véhicule Firestore ne pointe ce device
  | 'MULTIPLE_VEHICLES'             // plusieurs véhicules pointent ce device
  | 'UNIQUE_ID_MISMATCH'            // vehicles.uniqueId ≠ uniqueId Traccar
  | 'OWNER_NOT_FOUND'               // ownerId du véhicule sans profil users/{uid}
  | 'OWNER_NOT_LINKED_TRACCAR'      // client sans traccarUserId
  | 'OWNER_NO_TRACCAR_PERMISSION';  // (détail uniquement) le compte Traccar du client ne voit pas ce device

interface AdminDeviceItem {
  id: number;                       // ID Traccar
  name: string;
  uniqueId: string;                 // IMEI / identifiant tracker
  model: string | null;
  category: string | null;
  disabled: boolean;
  status: string | null;            // 'online' | 'offline' | 'unknown'
  lastUpdate: string | null;        // ISO, null = jamais vu
  lastSeenAgeSeconds: number | null;
  vehicle: { id: string; label: string | null; plate: string | null; ownerId: string | null; uniqueId: string | null } | null;
  client: { id: string; email: string | null; name: string | null } | null;
  issues: DeviceIssue[];
}

interface OrphanVehicle {
  vehicle: { id: string; label: string | null; plate: string | null; ownerId: string | null; deviceId: number | null; uniqueId: string | null };
  reason: 'DEVICE_NOT_FOUND'               // véhicule pointant un device inexistant dans Traccar
        | 'DEVICE_NOT_IN_CLIENT_ACCOUNT';  // (avec clientId) device absent du compte Traccar du client
}

interface AdminDeviceList extends CursorPage<AdminDeviceItem> {
  orphanVehicles?: OrphanVehicle[];  // présent uniquement sur la 1re page (sans cursor)
}
```

**Erreurs** : 400 (query invalide), 404 (`clientId` inconnu), 502/504 (Traccar).

> Les incohérences sont **signalées, jamais corrigées** automatiquement. L'UI affiche des badges par `issue` et un panneau « Véhicules orphelins » au-dessus du tableau (page 1).
> Coût : la route charge l'ensemble des devices Traccar puis filtre en mémoire ; éviter le polling agressif.

#### `GET /admin/v1/devices/:deviceId` — tout staff

`deviceId` : entier (sinon 400).

```ts
interface TraccarPosition {
  id: number; deviceId: number; protocol: string | null;
  serverTime: string; deviceTime: string; fixTime: string;
  outdated: boolean; valid: boolean;
  latitude: number; longitude: number; altitude: number;
  speed: number;      // nœuds (unité Traccar) — convertir ×1.852 pour km/h
  course: number; address: string | null; accuracy: number;
  attributes: Record<string, unknown>; // ignition, batteryLevel, motion…
}

interface AdminDeviceDetail extends AdminDeviceItem {
  phone: string | null;
  contact: string | null;
  groupId: number | null;
  attributes: Record<string, unknown>;
  lastPosition: TraccarPosition | null;
}
```

Peut ajouter `OWNER_NO_TRACCAR_PERMISSION` dans `issues`. **Erreurs** : 404 « Device introuvable », 502/504.

#### `GET /admin/v1/devices/:deviceId/positions?from=&to=` — tout staff

| Paramètre | Requis | Contrainte |
|---|---|---|
| `from` | oui | ISO |
| `to` | oui | ISO, `> from`, fenêtre **≤ 7 jours** |

Réponse `data` : `TraccarPosition[]` (non paginé, ordre Traccar chronologique).
**Erreurs** : 400 (`"to" doit être postérieur à "from"`, `Fenêtre limitée à 7 jours`), 404, 502/504.

UI : sélecteur de période borné à 7 jours (défaut : dernières 24 h), carte chargée dynamiquement (`next/dynamic`, `ssr: false`).

#### `PATCH /admin/v1/devices/:deviceId` — `support`, `super_admin`

Modifie un device Traccar. Le backend renvoie toujours l'objet **complet** à Traccar (pas d'effacement des champs omis). Si `uniqueId` change, les véhicules Firestore rattachés sont resynchronisés.

**Body** (au moins un champ en plus de `reason`, sinon 400 « Aucun champ à modifier ») :

```ts
interface AdminUpdateDeviceBody {
  reason: string;          // 5–500
  name?: string;           // non vide
  uniqueId?: string;       // non vide
  groupId?: number;        // entier
  phone?: string;
  model?: string;
  contact?: string;
  category?: string;
}
```

`disabled` et `attributes` ne sont **pas** acceptés ici (400).

**Réponse `data`**

```ts
interface DeviceEditableFields {
  name: string; uniqueId: string; disabled: boolean; groupId: number | null;
  phone: string | null; model: string | null; contact: string | null; category: string | null;
}
interface DeviceMutationResult { deviceId: number; changed: boolean; device: DeviceEditableFields }
```

Audit : `device.update`. **Erreurs** : 400, 403, 404, 502/504.

#### `POST /admin/v1/devices/:deviceId/disable` et `/enable` — `support`, `super_admin`

**Body** : `{ reason: string }` · **Réponse** : `DeviceMutationResult` (200). `changed: false` si déjà dans l'état demandé.
Audit : `device.disable` / `device.enable`.

#### `POST /admin/v1/devices/:deviceId/link` — `support`, `super_admin`

Rattache un device à un véhicule d'un client : ajoute la permission Traccar du client si absente, puis écrit `deviceId` + `uniqueId` sur `vehicles/{vehicleId}`.

**Body**

```ts
interface AdminLinkDeviceBody { vehicleId: string; ownerId: string; reason: string }
```

**Réponse `data`**

```ts
interface DeviceLinkResult { deviceId: number; vehicleId: string; ownerId: string; changed: boolean }
```

**Erreurs**

| Statut | Cas |
|---|---|
| 400 | Véhicule n'appartenant pas à `ownerId` ; client sans compte Traccar |
| 404 | Device, véhicule ou client introuvable |
| 409 | Véhicule déjà rattaché à un **autre** device, ou device déjà rattaché à un **autre** véhicule — jamais de déplacement implicite : détacher d'abord (non disponible via API pour l'instant, voir §9) |
| 502/504 | Traccar |

Audit : `device.link`.

---

### 5.3 Clients

#### `PATCH /admin/v1/clients/:uid/access` — `support`, `super_admin`

Suspend ou réactive un compte Firebase Auth. Une suspension **révoque aussi les sessions** en cours.

**Body** : `{ disabled: boolean; reason: string }`

**Réponse `data`** : `{ uid: string; disabled: boolean; changed: boolean }`

**Erreurs** : 400 (son propre compte), 403 (compte staff ciblé par un non `super_admin`), 404 (utilisateur introuvable).
Audit : `client.suspend` / `client.reactivate`.

#### `GET /admin/v1/clients/:uid/notes?cursor=&limit=` — `support`, `billing`, `super_admin`

```ts
interface ClientNote {
  id: string; clientId: string; body: string;
  authorUid: string; authorEmail: string | null;
  createdAt: string | null; // ISO
}
```

Réponse `data` : `CursorPage<ClientNote>`, du plus récent au plus ancien.

#### `POST /admin/v1/clients/:uid/notes` — `support`, `super_admin`

**Body** : `{ body: string }` (1–2000 caractères, **pas de `reason`**). **Réponse** : `ClientNote` (201).
Notes **append-only** : ni modification ni suppression. 404 si le client n'existe pas dans Auth. Audit : `client.note.create`.

---

### 5.4 Abonnements

#### `POST /admin/v1/subscriptions/:uid/adjustments` — `billing`, `super_admin`

Ajustement manuel de `subscriptions/{uid}`.

**Body** (au moins un de `planId`, `status`, `endDate`) :

```ts
interface AdminSubscriptionAdjustmentBody {
  reason: string;
  planId?: string;                                         // doit exister dans plans/ ; copie plans/{planId}.permissions
  status?: 'trial' | 'active' | 'expired' | 'cancelled';
  endDate?: string;                                        // ISO
}
```

**Règles de cohérence** (sur l'état résultant) :

- `endDate > startDate` ;
- `active` ou `trial` ⇒ `endDate` dans le futur ;
- `expired` ⇒ `endDate` dans le passé ;
- `trialEndDate`, `billingCycle`, `autoRenew` ne sont pas modifiés.

**Réponse `data`** (201)

```ts
interface SubscriptionState {
  planId: string | null; status: string | null; endDate: string | null;
  permissions: Record<string, unknown> | null;
}
interface SubscriptionAdjustmentResult { uid: string; before: SubscriptionState; after: SubscriptionState }
```

Afficher un diff `before` / `after` à l'opérateur après succès.
**Erreurs** : 400 (aucun changement, plan inconnu ou sans permissions, incohérence de dates), 404 (abonnement introuvable). Audit : `subscription.adjust`.

> ⚠️ Pas de `changed: false` ici : chaque appel valide écrit et est audité. Le formulaire ne doit envoyer que les champs réellement modifiés.

---

### 5.5 Staff

Toutes les routes : **`super_admin` uniquement**.

#### `GET /admin/v1/staff`

Réponse `data` : `StaffMember[]` (liste complète, non paginée).

```ts
type StaffRole = 'super_admin' | 'support' | 'billing' | 'viewer';
interface StaffMember {
  uid: string; email: string | null; displayName: string | null;
  role: StaffRole | null; disabled: boolean;
  mfaEnrolled: boolean;          // afficher un avertissement si false
  lastSignInTime: string | null; // format date HTTP Firebase (ex. "Mon, 10 Nov 2026 08:00:00 GMT"), pas ISO
}
```

#### `POST /admin/v1/staff`

**Body** : `{ email: string; role: StaffRole; reason: string }` · **Réponse** : `StaffMember` (201).
**Erreurs** : 400 (soi-même), 404 (aucun compte Auth pour cet email), 409 (déjà staff → utiliser `PATCH`). Audit : `staff.grant`.

#### `PATCH /admin/v1/staff/:uid`

**Body** : `{ role: StaffRole | null; reason: string }` — `role: null` **retire** l'accès staff.
**Réponse** : `{ member: StaffMember; changed: boolean }`.
**Erreurs** : 400 (soi-même — garantit qu'il reste au moins un `super_admin`), 404 (compte non staff ou introuvable). Audit : `staff.update` / `staff.revoke`.

Le changement révoque les sessions de la personne : elle devra se reconnecter.

---

### 5.6 Journal d'audit

#### `GET /admin/v1/audit-logs` — `support`, `billing`, `super_admin`

**Query** : `targetType`, `targetId`, `actorUid`, `action` (égalité stricte, combinables), `cursor`, `limit`. Tri : `createdAt` décroissant.

```ts
type AuditAction =
  | 'client.suspend' | 'client.reactivate' | 'client.note.create'
  | 'subscription.adjust'
  | 'device.update' | 'device.disable' | 'device.enable' | 'device.link'
  | 'staff.grant' | 'staff.update' | 'staff.revoke';

type AuditTargetType = 'client' | 'subscription' | 'device' | 'staff';

interface AuditLogEntry {
  id: string;
  actorUid: string; actorEmail: string | null; actorRole: StaffRole;
  requestId: string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;                 // uid client / uid staff / ID device (string)
  result: 'success' | 'failure';
  reason: string | null;
  before: Record<string, unknown> | null;  // clés sensibles remplacées par "[REDACTED]"
  after: Record<string, unknown> | null;
  error: string | null;
  createdAt: string | null;         // ISO
}
```

Réponse `data` : `CursorPage<AuditLogEntry>`.

Usages UI : onglet « Historique » d'une fiche client (`targetType=client&targetId=<uid>`), fiche device (`targetType=device&targetId=<id>`), abonnement (`targetType=subscription&targetId=<uid>`), page globale « Audit » filtrable.

> Chaque combinaison de filtres + `orderBy(createdAt)` nécessite un **index composite Firestore**. Au premier appel sans index, l'API renvoie une 500 et le lien de création d'index apparaît dans les logs serveur (voir §9).

---

## 6. Lectures Firebase directes (sans route NestJS)

Ces lectures se font dans le serveur Next.js avec Firebase Admin SDK, **après** `getStaffSession()`. Organiser en fonctions typées dans `lib/data/*` (`import 'server-only'`).

| Fonction suggérée | Source | Notes |
|---|---|---|
| `getClientsPage({ pageToken })` | `auth.listUsers(100, pageToken)` + `users` (lecture groupée `in` par 30) + `subscriptions` | Auth fournit `email`, `disabled`, `metadata` ; Firestore fournit `name`, `phoneNumber`, `userType`. Exclure les comptes ayant un claim `staffRole`. |
| `getClientOverview(uid)` | `auth.getUser`, `users/{uid}`, `subscriptions/{uid}`, compteurs `vehicles`/`drivers`/`documents`/`assignments` (`where('ownerId','==',uid).count()`) | Plus `GET /admin/v1/devices?clientId=` pour les devices et `GET /admin/v1/clients/:uid/notes`. |
| `getClientVehicles(uid)` etc. | `vehicles`, `drivers`, `assignments`, `documents`, `payment_logs`, `notifications` filtrés par `ownerId` | Pagination `startAfter` + `limit`. |
| `getSubscriptionsPage(filters)` | `subscriptions` (filtre `status`, `planId`, tri `endDate`) | Index composites à créer. |
| `getPlans()` | `plans` | Lecture seule (pas d'édition au MVP). |
| `getDashboardMetrics(period)` | Agrégations `count()` | Préférer des agrégats pré-calculés si le volume grossit. |

**Projection obligatoire sur `users`** : toujours `.select(...)` ou un mapper qui **exclut `traccarPassword` et `fcmToken`** avant de passer quoi que ce soit à un Client Component.

```ts
// lib/data/clients.ts
import 'server-only';
import { adminDb } from '@/lib/firebase-admin';

const USER_FIELDS = ['name', 'email', 'phoneNumber', 'photoUrl', 'userType', 'role', 'createdAt', 'traccarUserId'] as const;

export async function getUserProfiles(uids: string[]) {
  const chunks = Array.from({ length: Math.ceil(uids.length / 30) }, (_, i) => uids.slice(i * 30, i * 30 + 30));
  const snaps = await Promise.all(
    chunks.map((c) => adminDb.collection('users').where('__name__', 'in', c).select(...USER_FIELDS).get()),
  );
  return new Map(snaps.flatMap((s) => s.docs).map((d) => [d.id, { id: d.id, ...d.data() }]));
}
```

> Recherche par nom/téléphone : `listUsers` n'est pas un moteur de recherche. Au MVP, recherche exacte par UID / email (`getUserByEmail`) / téléphone (`getUserByPhoneNumber`) ; une projection `admin_client_index` sera nécessaire pour une recherche partielle.

---

## 7. Implémentation côté Next.js

### 7.1 Variables d'environnement

```bash
# Serveur uniquement
ADMIN_API_URL=https://api.zira.ci
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."   # ou ADC / Secret Manager
APP_ENV=production                                          # local | staging | production

# Navigateur (config publique Firebase Web uniquement)
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
```

Le projet Firebase du backoffice doit être **le même** que celui du backend (le backend vérifie l'audience du token).

### 7.2 Arborescence suggérée

```
src/
  app/
    (auth)/login/page.tsx
    (backoffice)/
      layout.tsx                 # getStaffSession() + AppShell
      page.tsx                   # tableau de bord
      clients/page.tsx, clients/[uid]/page.tsx
      subscriptions/page.tsx
      devices/page.tsx, devices/[deviceId]/page.tsx
      audit/page.tsx
      staff/page.tsx
      system/page.tsx            # /health
    api/session/route.ts
  lib/
    firebase-admin.ts            # server-only
    firebase-client.ts           # Web SDK
    auth/session.ts, auth/permissions.ts
    admin-api/client.ts          # fetch typé vers /admin/v1 (server-only)
    admin-api/types.ts           # types §5
    admin-api/schemas.ts         # Zod pour les formulaires
    data/*.ts                    # lectures Admin SDK (§6)
  actions/                       # Server Actions de mutation
  middleware.ts
```

### 7.3 Client API typé (serveur uniquement)

```ts
// lib/admin-api/client.ts
import 'server-only';
import { randomUUID } from 'node:crypto';
import { getStaffSession } from '@/lib/auth/session';

export class AdminApiError extends Error {
  constructor(public status: number, message: string, public requestId: string | null) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | undefined>;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  query?: Query;
  body?: unknown;
  idempotencyKey?: string;
}

export async function adminFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { token } = await getStaffSession();
  const url = new URL(`/admin/v1${path}`, process.env.ADMIN_API_URL);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  }

  const requestId = randomUUID();
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Request-Id': requestId,
      ...(opts.body !== undefined && { 'Content-Type': 'application/json' }),
      ...(opts.idempotencyKey && { 'Idempotency-Key': opts.idempotencyKey }),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });

  const json = (await res.json().catch(() => null)) as { success: boolean; message: string; data: T } | null;
  if (!res.ok || !json?.success) {
    throw new AdminApiError(res.status, json?.message ?? `Erreur HTTP ${res.status}`, res.headers.get('x-request-id') ?? requestId);
  }
  return json.data;
}

// Raccourcis
export const adminApi = {
  health: () => adminFetch<HealthReport>('/health'),
  devices: (q: DevicesQuery) => adminFetch<AdminDeviceList>('/devices', { query: q }),
  device: (id: number) => adminFetch<AdminDeviceDetail>(`/devices/${id}`),
  positions: (id: number, from: string, to: string) =>
    adminFetch<TraccarPosition[]>(`/devices/${id}/positions`, { query: { from, to } }),
  updateDevice: (id: number, body: AdminUpdateDeviceBody, key: string) =>
    adminFetch<DeviceMutationResult>(`/devices/${id}`, { method: 'PATCH', body, idempotencyKey: key }),
  setDeviceDisabled: (id: number, disabled: boolean, reason: string, key: string) =>
    adminFetch<DeviceMutationResult>(`/devices/${id}/${disabled ? 'disable' : 'enable'}`, { method: 'POST', body: { reason }, idempotencyKey: key }),
  linkDevice: (id: number, body: AdminLinkDeviceBody, key: string) =>
    adminFetch<DeviceLinkResult>(`/devices/${id}/link`, { method: 'POST', body, idempotencyKey: key }),
  setClientAccess: (uid: string, disabled: boolean, reason: string, key: string) =>
    adminFetch<{ uid: string; disabled: boolean; changed: boolean }>(`/clients/${encodeURIComponent(uid)}/access`, { method: 'PATCH', body: { disabled, reason }, idempotencyKey: key }),
  clientNotes: (uid: string, q: { cursor?: string; limit?: number } = {}) =>
    adminFetch<CursorPage<ClientNote>>(`/clients/${encodeURIComponent(uid)}/notes`, { query: q }),
  addClientNote: (uid: string, body: string, key: string) =>
    adminFetch<ClientNote>(`/clients/${encodeURIComponent(uid)}/notes`, { method: 'POST', body: { body }, idempotencyKey: key }),
  adjustSubscription: (uid: string, body: AdminSubscriptionAdjustmentBody, key: string) =>
    adminFetch<SubscriptionAdjustmentResult>(`/subscriptions/${encodeURIComponent(uid)}/adjustments`, { method: 'POST', body, idempotencyKey: key }),
  auditLogs: (q: AuditLogsQuery) => adminFetch<CursorPage<AuditLogEntry>>('/audit-logs', { query: q }),
  staff: () => adminFetch<StaffMember[]>('/staff'),
  grantStaff: (body: { email: string; role: StaffRole; reason: string }, key: string) =>
    adminFetch<StaffMember>('/staff', { method: 'POST', body, idempotencyKey: key }),
  updateStaffRole: (uid: string, role: StaffRole | null, reason: string, key: string) =>
    adminFetch<{ member: StaffMember; changed: boolean }>(`/staff/${encodeURIComponent(uid)}`, { method: 'PATCH', body: { role, reason }, idempotencyKey: key }),
};
```

(Importer les types de §5 depuis `./types`.)

### 7.4 Schémas Zod (formulaires)

Alignés sur les DTO backend — garder ces bornes synchronisées :

```ts
// lib/admin-api/schemas.ts
import { z } from 'zod';

export const reason = z.string().trim().min(5, 'Motif : 5 caractères minimum').max(500);
export const staffRole = z.enum(['super_admin', 'support', 'billing', 'viewer']);

export const clientAccessSchema = z.object({ disabled: z.boolean(), reason });

export const clientNoteSchema = z.object({ body: z.string().trim().min(1).max(2000) });

export const subscriptionAdjustmentSchema = z
  .object({
    reason,
    planId: z.string().min(1).optional(),
    status: z.enum(['trial', 'active', 'expired', 'cancelled']).optional(),
    endDate: z.string().datetime().optional(),
  })
  .refine((v) => v.planId || v.status || v.endDate, { message: 'Modifier au moins un champ' })
  .refine((v) => !v.endDate || !v.status || !['active', 'trial'].includes(v.status) || new Date(v.endDate) > new Date(),
    { message: 'Un abonnement actif/essai doit avoir une date de fin future', path: ['endDate'] })
  .refine((v) => !v.endDate || v.status !== 'expired' || new Date(v.endDate) < new Date(),
    { message: 'Un abonnement expiré doit avoir une date de fin passée', path: ['endDate'] });

export const updateDeviceSchema = z
  .object({
    reason,
    name: z.string().trim().min(1).optional(),
    uniqueId: z.string().trim().min(1).optional(),
    groupId: z.number().int().optional(),
    phone: z.string().optional(),
    model: z.string().optional(),
    contact: z.string().optional(),
    category: z.string().optional(),
  })
  .refine(({ reason: _r, ...rest }) => Object.values(rest).some((v) => v !== undefined), { message: 'Aucun champ à modifier' });

export const linkDeviceSchema = z.object({ vehicleId: z.string().min(1), ownerId: z.string().min(1), reason });

export const grantStaffSchema = z.object({ email: z.string().email(), role: staffRole, reason });
export const updateStaffRoleSchema = z.object({ role: staffRole.nullable(), reason });
```

> Envoyer au backend uniquement les champs **modifiés** (diff avec les valeurs initiales du formulaire) pour `PATCH /devices/:id` et les ajustements d'abonnement.

### 7.5 Server Actions de mutation

```ts
// actions/client-access.ts
'use server';
import { revalidatePath } from 'next/cache';
import { adminApi, AdminApiError } from '@/lib/admin-api/client';
import { clientAccessSchema } from '@/lib/admin-api/schemas';

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string; requestId: string | null; fieldErrors?: Record<string, string[]> };

export async function setClientAccess(uid: string, input: unknown, idempotencyKey: string): Promise<ActionResult<{ changed: boolean }>> {
  const parsed = clientAccessSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, status: 400, message: 'Formulaire invalide', requestId: null, fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    const data = await adminApi.setClientAccess(uid, parsed.data.disabled, parsed.data.reason, idempotencyKey);
    revalidatePath(`/clients/${uid}`);
    return { ok: true, data };
  } catch (e) {
    if (e instanceof AdminApiError) return { ok: false, status: e.status, message: e.message, requestId: e.requestId };
    throw e;
  }
}
```

Côté client, la boîte `ConfirmActionDialog` :

1. génère `idempotencyKey = crypto.randomUUID()` à l'ouverture ;
2. affiche l'entité ciblée et la **conséquence** (ex. « Le client sera déconnecté de toutes ses sessions ») ;
3. exige le motif (Zod `reason`) ;
4. appelle la Server Action ; sur `ok && !data.changed` → toast « Aucun changement » ; sur erreur → message + `requestId` ; sur 401 → redirection login.

Avec TanStack Query, appeler les Server Actions dans `useMutation` et invalider les clés concernées (`['client', uid]`, `['audit', 'client', uid]`, `['devices']`…).

### 7.6 Permissions UI

```ts
// lib/auth/permissions.ts
import type { StaffRole } from '@/lib/admin-api/types';

const P = {
  'devices.read':        ['super_admin', 'support', 'billing', 'viewer'],
  'devices.write':       ['super_admin', 'support'],
  'clients.access':      ['super_admin', 'support'],
  'clients.notes.read':  ['super_admin', 'support', 'billing'],
  'clients.notes.write': ['super_admin', 'support'],
  'subscriptions.adjust':['super_admin', 'billing'],
  'audit.read':          ['super_admin', 'support', 'billing'],
  'staff.manage':        ['super_admin'],
} as const satisfies Record<string, readonly StaffRole[]>;

export type Permission = keyof typeof P;
export const can = (role: StaffRole, p: Permission) => (P[p] as readonly StaffRole[]).includes(role);
```

Utiliser `can()` pour masquer menus/boutons et pour refuser l'accès aux pages (`notFound()` / page 403) ; le backend reste l'autorité.

### 7.7 Filtres dans l'URL

Les filtres de tableaux (`status`, `staleBefore`, `neverSeen`, `disabled`, `unlinked`, `clientId`, `cursor`) vivent dans `searchParams` pour être partageables. Les booléens sont transmis en chaînes `"true"` / `"false"` ; omettre le paramètre pour « tous ». Le préréglage « Silencieux > 24 h » correspond à `staleBefore = new Date(Date.now() - 864e5).toISOString()`.

---

## 8. Correspondance écrans → données

| Écran | Lectures | Actions (rôle) |
|---|---|---|
| **Tableau de bord** | Admin SDK (compteurs clients, abonnements par statut, documents expirés, `payment_logs`) + `GET /devices` (statuts) | — |
| **Clients — liste** | Admin SDK `listUsers` + `users` + `subscriptions` | — |
| **Client — fiche** | Admin SDK (profil, Auth, abonnement, compteurs, véhicules…) · `GET /devices?clientId=` · `GET /clients/:uid/notes` · `GET /audit-logs?targetType=client&targetId=` | Suspendre/réactiver (`support`, `super_admin`) · Ajouter note (`support`, `super_admin`) · Ajuster abonnement (`billing`, `super_admin`) |
| **Abonnements** | Admin SDK `subscriptions` + `plans` · `GET /audit-logs?targetType=subscription&targetId=` | Ajuster (`billing`, `super_admin`) |
| **Devices — liste** | `GET /devices` (+ `orphanVehicles`) | — |
| **Device — fiche** | `GET /devices/:id` · `GET /devices/:id/positions` · `GET /audit-logs?targetType=device&targetId=` | Modifier, désactiver/réactiver, rattacher (`support`, `super_admin`) |
| **Audit** | `GET /audit-logs` | — (`viewer` exclu) |
| **Staff** | `GET /staff` | Ajouter, changer de rôle, retirer (`super_admin`) |
| **Système** | `GET /health` | — |

---

## 9. Limites connues et prérequis

| Sujet | État | Impact UI |
|---|---|---|
| **Index Firestore composites** pour `admin_audit_logs` (chaque filtre + `createdAt desc`) et `admin_client_notes (clientId, createdAt desc)` | À créer en prod (lien dans l'erreur `FAILED_PRECONDITION` des logs) | Tant qu'absents : 500 sur les listes filtrées. |
| Erreurs sans `code` machine ni `requestId` dans le corps | Contrat actuel (`{success, message, data}`) | Brancher la logique sur le statut HTTP ; lire `X-Request-Id` en header. |
| `X-Request-Id` absent sur les 401/403 du guard | Le header est posé après authentification | Utiliser l'ID généré côté Next.js. |
| **Détacher** un device d'un véhicule | Pas de route | Un 409 au rattachement ne peut pas être résolu depuis l'UI : afficher le conflit et escalader. |
| **Créer / supprimer** un device | Pas de route admin | Hors périmètre MVP. |
| `GET /admin/v1/documents/:id/download-url` | Reporté (fichiers Cloudinary publics `type: upload`) | Ne pas afficher les documents par défaut ; lien direct uniquement si validé. |
| `POST /admin/v1/jobs/:name/run` | Reporté (Cloud Functions `*Now` non sécurisées) | Pas de bouton « lancer un job ». |
| Recherche client partielle (nom/téléphone) | Pas d'index de recherche | Recherche exacte UID/email/téléphone au MVP. |
| Flux temps réel staff (Socket.IO) | Non disponible pour le staff | Rafraîchissement manuel / polling modéré. |
| `GET /devices` charge tout Traccar à chaque appel | Filtrage en mémoire | Pas de polling < 30 s ; mettre en cache court côté Next.js si besoin. |
| CORS non activé sur l'API | Normal : appels serveur à serveur | Ne jamais appeler l'API depuis le navigateur. |
| Traccar injoignable depuis l'environnement local | Problème réseau (cf. `BACKOFFICE_PLAN.md`) | En local, prévoir des états 502/504 propres ; utiliser un mock si nécessaire. |

---

## 10. Checklist d'intégration

**Fondations**
- [ ] Firebase Web SDK (login + MFA) et Admin SDK (`server-only`) configurés sur le **même projet** que le backend.
- [ ] Cookie `__session` HttpOnly synchronisé via `onIdTokenChanged` ; `getStaffSession()` vérifie token + claim `staffRole` avec `checkRevoked`.
- [ ] `adminFetch` avec Bearer, `X-Request-Id`, timeout, `cache: 'no-store'`, gestion de l'enveloppe et `AdminApiError`.
- [ ] Bandeau d'environnement (`APP_ENV`) dans l'en-tête.

**Contrats**
- [ ] Types §5 copiés dans `lib/admin-api/types.ts`, schémas Zod §7.4 alignés sur les DTO (motif 5–500, note 1–2000, `limit` ≤ 100).
- [ ] Aucun champ hors contrat envoyé (whitelist stricte → 400).
- [ ] Mapping des statuts HTTP (§4.3) : 401 → login, 403 → accès refusé, 409/422 → message, 502/504 → bannière Traccar.

**Mutations**
- [ ] `ConfirmActionDialog` : entité + conséquence + motif obligatoire + `Idempotency-Key` par intention.
- [ ] Gestion de `changed: false` (« Aucun changement »).
- [ ] Invalidation des données et de l'onglet « Historique » (audit) après chaque mutation.

**Sécurité**
- [ ] Aucune donnée `traccarPassword` / `fcmToken` dans les props des Client Components (projections §6).
- [ ] Permissions UI via `can()` uniquement ; aucune décision de sécurité côté navigateur.
- [ ] Aucun secret en `NEXT_PUBLIC_*`.

**Tests**
- [ ] Un compte non staff ne peut ouvrir aucune page (redirection) ; un `viewer` ne voit aucun bouton de mutation.
- [ ] Parcours e2e : suspension client, ajustement abonnement, désactivation device, rattachement (cas 409), gestion staff, lecture de l'audit correspondant.
