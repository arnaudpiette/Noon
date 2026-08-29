# Mémoire privée de Noon

La mémoire privée est distincte de l’historique de conversation et des anciennes préférences. Les contenus sont chiffrés en AES-256-GCM dans la base locale du répertoire utilisateur de l’application. La clé maîtresse est elle-même protégée par `safeStorage` sur macOS et n’est jamais exposée au navigateur.

Les profils `arnaud`, `alexandra`, `sinan`, `kaan`, `household`, `noon` et `projects` sont séparés. Les données sensibles, celles concernant les enfants, la santé, le droit, les finances, l’adresse ou l’école nécessitent une validation et une confirmation selon leur politique API. Une mémoire `pending_review`, `local_only`, expirée ou supprimée ne peut pas être injectée dans une requête.

L’import d’un seed privé suit deux temps : aperçu local, puis sélection explicite des entrées. Aucun appel réseau n’est réalisé. Le fichier réel doit rester hors du dépôt ; seul un exemple fictif peut servir aux tests.

Pour chaque réponse, Noon construit un contexte minimal avec un budget de caractères, conserve seulement les identifiants utilisés pour l’écran « Pourquoi Noon sait cela ? » et envoie les requêtes privées avec `store: false`. Ce réglage ne supprime pas les règles générales de conservation de l’API OpenAI.
