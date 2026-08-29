# Reliability Engine

Le `Reliability Engine` est la source canonique de l’état opérationnel de Noon. Il sépare un résultat vide valide d’une source impossible à vérifier et permet au reste de l’application de continuer honnêtement en mode partiel.

## Architecture

- `services/reliability/reliability-engine.js` contient le registre, les snapshots, le classifieur, les retries, le circuit breaker et les réparations sûres.
- Les connecteurs et engines publient leurs succès et échecs réels. Un appel métier réussi sert donc aussi de health check passif.
- Le serveur n’effectue au démarrage que les contrôles critiques. Les services optionnels sont contrôlés à la demande ou pendant un diagnostic profond.
- L’Orchestrator évite les modèles connus comme indisponibles et produit les diagnostics à partir des snapshots réels.

## États et erreurs

Les états publics sont `HEALTHY`, `DEGRADED`, `UNAVAILABLE`, `UNAUTHORIZED`, `MISCONFIGURED`, `STALE` et `UNKNOWN`. La disponibilité globale distingue `CORE_READY`, `FULLY_READY`, `DEGRADED_READY` et `NOT_READY`.

Les catégories normalisées sont : `NO_DATA`, `SERVICE_UNAVAILABLE`, `AUTH_REQUIRED`, `PERMISSION_DENIED`, `TIMEOUT`, `RATE_LIMITED`, `NETWORK_ERROR`, `INVALID_RESPONSE`, `STALE_DATA`, `PARTIAL_FAILURE`, `INTERNAL_ERROR`, `CONFIGURATION_ERROR` et `UNKNOWN_OUTCOME`.

`NO_DATA` signifie que la source a répondu correctement avec zéro résultat. Une authentification absente, une panne ou un timeout ne peut donc jamais être présenté comme « rien trouvé ».

## Contrats de sûreté

- Les lectures idempotentes peuvent être retentées avec backoff exponentiel, jitter et limite stricte.
- Les écritures, envois et actions non idempotentes ne sont jamais retentés aveuglément.
- Une interruption dont le résultat externe est incertain produit `UNKNOWN_OUTCOME` et demande une vérification.
- Le circuit breaker suspend temporairement un composant après des échecs transitoires répétés.
- Les seules réparations automatiques sont locales, réversibles et sans perte, par exemple vider un cache périmé reconstructible.
- Une base, une mémoire, un fichier source, un compte ou une configuration distante ne sont jamais supprimés ou réinitialisés automatiquement.

## Diagnostic local

- `GET /api/health` : snapshot léger en cache.
- `GET /api/health/:component` : contrôle ciblé.
- `POST /api/health/diagnose` avec `X-Noon-Request: 1` : diagnostic actif ; `{ "deep": true }` autorise les checks plus coûteux.
- `POST /api/health/:component/repair` avec `X-Noon-Request: 1` : uniquement une réparation explicitement déclarée sûre.

Les réponses ne contiennent ni exception brute, ni token, ni adresse e-mail, ni chemin privé. Les détails techniques locaux passent par le même pipeline de redaction et sont regroupés avec un fingerprint sans secret.

## Couverture des sources

La recherche personnelle et le brief matinal conservent les sources attendues, réussies, vides et en échec. Un résultat est `partial` dès qu’une source attendue n’a pas pu être vérifiée. Le planning refuse de déduire qu’un créneau est libre lorsque Calendar est indisponible.

## Observabilité

Les événements couvrent les checks, changements d’état, échecs, récupérations, fallbacks, ouverture/fermeture du circuit, retries, latences et compteurs. Le moteur reste fonctionnel si l’observabilité échoue et l’historique local est volontairement borné.
