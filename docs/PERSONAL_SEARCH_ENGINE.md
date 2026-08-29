# Personal Search Engine

Le `PersonalSearchEngine` est la façade de recherche unique de Noon. Il ne remplace aucun stockage et ne copie pas les données dans un index global. Chaque adaptateur interroge la source native, transforme seulement les meilleurs résultats dans un format commun et conserve un localisateur vérifiable.

## Sources

- conversations locales et leurs résumés ;
- `MemoryEngine`, sans accès direct aux dépôts de mémoire depuis l’orchestrateur ;
- projets structurés et registre des projets locaux ;
- fichiers et documents situés dans les racines autorisées ;
- Apple Notes et Rappels sur macOS ;
- Gmail et Google Calendar seulement lorsqu’ils sont connectés.

La sélection est déterministe. Noon commence par les sources suggérées par la question ou explicitement demandées. Il élargit uniquement en l’absence de résultat, sauf recherche globale explicite. Chaque source a un délai maximal et les résultats déjà obtenus restent utilisables en cas de panne partielle.

## Format et provenance

Chaque résultat possède un identifiant, un type et identifiant de source, un titre, un extrait borné, un score, une confiance, une portée profil/projet, une provenance, un niveau d’accès et un `locator`. Une citation n’est créée que si ce localisateur existe. Les doublons conservent leurs sources de soutien ; les affirmations contradictoires restent séparées et sont signalées comme non résolues.

## Confidentialité

Les permissions sont vérifiées avant la lecture. Les fichiers sont résolus par leur chemin réel afin de bloquer les liens symboliques sortant des racines autorisées. L’isolation des profils et des projets est appliquée avant classement. Une mémoire `local_only`, candidate ou non consentie peut rester visible dans une recherche locale, mais elle est retirée de l’evidence envoyée au modèle.

Les journaux ne contiennent ni requête ni extrait : seulement un fingerprint, l’intention, les sources, les statuts, les durées et les compteurs. Gmail utilise le mode `metadata` et ne charge pas le corps complet pendant une recherche unifiée.

## Classement et cache

Le classement hybride local combine expression exacte, termes, synonymes légers, autorité de la source, portée projet, statut mémoire et intention. Aucun embedding externe n’est utilisé. Pour le volume personnel actuel, ce choix réduit coût, latence et exposition des données. L’interface permet d’ajouter ultérieurement un moteur sémantique local sans modifier le format canonique.

Le cache mémoire est borné à 50 entrées et 30 secondes. Sa clé inclut la requête structurée, les permissions et versions exposées par les adaptateurs. Les écritures mémoire/projet et révocations de conversation invalident explicitement le cache.

## API locale et skill

- `POST /personal-search`, protégé par `X-Noon-Request: 1`, expose les résultats locaux à l’interface.
- `search_personal_sources` est enregistré dans le Skill Registry et utilisé par l’orchestrateur.
- Le handler du skill convertit toujours le résultat en evidence distante filtrée avant de le transmettre à la Responses API.

Exemple de requête locale :

```json
{
  "query": "où est gérée la voix principale ?",
  "sourceScopes": ["project", "file"],
  "projectId": "noon",
  "projectPath": "/chemin/autorisé/Noon",
  "profileScope": "arnaud",
  "maxResults": 10
}
```

## Limites assumées

- Notes et Rappels reposent sur les autorisations Automation de macOS.
- Gmail et Calendar nécessitent une connexion Google valide.
- Les formats binaires sont retrouvés par métadonnées ; leur contenu n’est pas extrait massivement pendant une recherche.
- La recherche sémantique repose actuellement sur des synonymes locaux explicites, sans embeddings.
