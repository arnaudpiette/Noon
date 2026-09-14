# Provider Abstraction — V2.1

## Statut

- OpenAI : `ACTIVE`
- Anthropic : `FUTURE` / `NOT_CONFIGURED`
- Google AI : `FUTURE` / `NOT_CONFIGURED`
- Local : `FUTURE` / `NOT_CONFIGURED`

Aucun provider supplémentaire n'est connecté en V2.1 et aucune clé fictive
n'est créée.

## Flux canonique

```text
NoonOrchestrator
  -> ModelRouter (sélection Luna / Terra / Sol, Astra en SHADOW)
  -> ModelProviderAdapter
  -> OpenAIProviderAdapter
  -> OpenAI Responses API
```

Le `ModelRouter` reste la source de vérité unique pour la sélection du modèle.
L'adapter ne choisit ni modèle, ni provider, ni priorité et ne consulte ni la
mémoire ni le contexte.

## Frontières

La requête interne contient seulement les champs nécessaires au chemin actuel :
modèle, entrée, outils, choix d'outil, raisonnement, format texte, compaction et
streaming. L'adapter traduit ces champs vers l'API du provider.

La réponse normalisée expose le texte, les appels d'outils, l'usage canonique,
le provider, le modèle, la fin de réponse et la latence. Les appels d'outils
restent des propositions : seul `NoonOrchestrator` peut les transmettre au
`SkillRegistry`, puis aux politiques de sécurité, d'approbation et d'exécution
transactionnelle.

Les catégories d'erreur publiques sont : `AUTH_ERROR`, `RATE_LIMIT`, `TIMEOUT`,
`NETWORK_ERROR`, `MODEL_UNAVAILABLE`, `PROVIDER_ERROR` et `INVALID_RESPONSE`.
Les messages bruts du provider ne remontent pas à l'interface.

## Confidentialité et mode local

L'adapter n'enregistre ni prompt, ni contenu utilisateur, ni mémoire, ni secret.
Le filtrage du contexte et la décision `LOCAL_ONLY` restent en amont. En V2.1,
aucun provider local n'étant actif, `LOCAL_ONLY` interdit toujours tout appel au
provider distant.
