# Règles Firestore à ajouter pour le backoffice

Le backoffice lit et écrit uniquement via Firebase Admin côté serveur (qui ignore les règles).
Les collections internes doivent donc être **fermées à tout client** (application mobile comprise).
À fusionner dans les règles existantes du projet mobile, après validation en staging :

```
match /admin_client_index/{uid} {
  allow read, write: if false;
}
match /admin_audit_logs/{id} {
  allow read, write: if false;
}
```

Intégrité append-only du journal d'audit : le compte de service du backoffice ne doit avoir
que la création sur `admin_audit_logs` (rôle IAM personnalisé ou export continu vers un
bucket Cloud Logging avec verrou de rétention). Aucune route du backoffice ne modifie ni ne
supprime une entrée.
