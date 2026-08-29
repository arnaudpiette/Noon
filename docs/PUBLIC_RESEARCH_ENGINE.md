# Public Research Engine

Noon sépare trois responsabilités : la connaissance générale du modèle, la recherche dans les données personnelles autorisées et la vérification récente sur Internet.

## Architecture

- `ResearchResolver` choisit `PERSONAL`, `PUBLIC` ou `MIXED`.
- `ResearchPlanner` borne les sous-requêtes et les coûts.
- `PrivacyQuerySanitizer` retire chemins locaux, e-mails, téléphones, profils protégés et contenus `local_only` avant tout appel distant.
- `WebSearchAdapter` encapsule l’outil `web_search` de la Responses API avec `store: false`.
- `SourceEvaluator` classe autorité et fraîcheur sans score artificiellement précis.
- `PublicResearchEngine` construit un Evidence Pack public, daté et cité.
- `MultiSourceSynthesisEngine` reste l’unique moteur de synthèse multi-source.

Le contenu Web est toujours marqué `external_web` et `untrusted_content`. Il n’est jamais interpolé dans les instructions système et ne peut déclencher ni outil local, ni écriture, ni changement de configuration.

## Rollout

- `research.public.v1` : actif pour une demande Web explicite, avec retour au chemin legacy via le feature flag.
- `research.mixed` : désactivé par défaut. Son activation exige que les évaluations critiques de confidentialité restent vertes.

## Limites

Le moteur utilise les passages et métadonnées fournis par Responses Web Search. Il ne télécharge pas les pages, scripts, archives ou exécutables et n’implémente aucun crawler. Les dates absentes restent `null`. Une panne fournisseur est distincte d’une recherche sans résultat.

## Vérification locale

```sh
npm run lint
node --test test/public-research-engine.test.js
npm run eval:public-research
npm run eval:privacy
npm test
```
