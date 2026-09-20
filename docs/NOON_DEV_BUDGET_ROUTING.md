# Noon Dev — routage automatique et budgets (V2.7)

## Propriétaires canoniques

Le `ModelRouter` de `lib/noon-intelligence.js` reste l'unique propriétaire du choix provider/modèle. Le `NativeDevCoordinator` transmet la qualité requise et les preuves d'échec ; il ne nomme jamais le modèle suivant.

`services/dev/dev-cost-budget-service.js` est uniquement responsable de la politique budgétaire, des réservations et du ledger. Il ne sélectionne aucun modèle. Les prix proviennent exclusivement de `services/observability/model-pricing.js`.

## Devise et limites

Le pricing fournisseur étant canonique en USD et aucune source FX fiable n'existant dans Noon, les limites V2.7 utilisent aussi l'USD. Aucun taux EUR fixe n'est inventé. La configuration utilisateur initiale est :

- tâche : illimitée (`0` dans la configuration signifie non configurée) ;
- jour DEV : illimité ;
- mois DEV : 20 USD, valeur modifiable et non constante métier ;
- périodes : jour et mois calendaires `Europe/Paris`, donc compatibles DST.

Les limites effectives prennent le minimum de `maxEstimatedCost`, du reste de la tâche, du jour et du mois. Désactiver l'enforcement conserve le suivi des coûts.

## Ledger local

Le ledger `dev-cost-ledger.json` reste dans le répertoire de données du processus principal. Une entrée contient uniquement les identifiants techniques d'appel, provider/modèle, estimation, coût calculé si disponible, devise, état, résultat et catégorie d'échec. Il ne contient ni prompt, ni code source, ni réponse, ni secret.

Le flux est `RESERVE → CALL → RECONCILE`. Un coût réel indisponible reste `null` et l'estimation est retenue prudemment dans les agrégats. Une réservation orpheline devient `UNKNOWN_PENDING_RECONCILIATION`, jamais une dépense nulle présumée. Les écritures sont atomiques par remplacement de fichier et les identifiants de réservation rendent la réconciliation idempotente.

Ce ledger est une mesure locale fondée sur l'usage et le registre de prix ; ce n'est pas la facture officielle d'un fournisseur.

## Routage et escalade

Le premier appel choisit le candidat autorisé le moins cher satisfaisant capacités, confidentialité, santé et `requiredQuality`. Un coût inconnu n'est pas considéré comme gratuit.

L'escalade intellectuelle exige :

1. un échec `QUALITY_FAILURE` ou `VALIDATION_FAILURE` attribuable au patch ;
2. l'épuisement des réparations cohérentes au même niveau (2 par défaut, configurable) ;
3. un palier qualité strictement supérieur dans le registre ;
4. la validation des budgets avant l'appel.

Une panne réseau, provider, authentification, rate limit, indisponibilité, timeout d'infrastructure, annulation, permission ou budget ne constitue jamais une preuve d'insuffisance intellectuelle. Retry, fallback, escalade, second opinion et spécialiste conservent des métriques distinctes. L'influence automatique de l'historique reste désactivée ; seules les métriques par tâche sont collectées.

## Sécurité et rollout

Les flags `dev.auto-routing`, `dev.budget-enforcement` et `dev.quality-escalation` sont `OFF` par défaut, indépendants et réversibles. Tous désactivés, le comportement V2.6 est conservé. `localOnly=true` bloque tout appel distant avant réservation. Les politiques workspace, terminal, confidentialité et approbation ne sont jamais contournées.

L'API locale protégée `GET /api/dev/budget` expose les agrégats tâche/jour/mois sans historique détaillé. L'interface graphique complète est différée : `DEV_BUDGET_UI=DEFERRED`.

## Limites connues

- Aucun dépassement ponctuel approuvé n'est automatisé en V2.7 ; augmenter une limite reste une modification explicite de configuration.
- Les coûts payants shadow, fallback et second opinion doivent utiliser le même service lorsqu'ils seront activés pour Native Dev ; ils restent désactivés par défaut ici.
- Claude, Antigravity et Cursor ne sont pas connectés. Codex reste un spécialiste optionnel orthogonal au ModelRouter.
- Le benchmark comparatif relève de V2.8 et n'est pas commencé.
