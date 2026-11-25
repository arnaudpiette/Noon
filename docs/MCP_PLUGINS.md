# Plugins Noon (connecteurs MCP, phase 5)

Un plugin Noon est un **fichier JSON déclaratif**. Il regroupe de 1 à 5 serveurs MCP distants et,
si besoin, une consigne d'usage courte pour le modèle. Il ne contient **aucun code** : Noon
n'exécute rien qui vienne d'un plugin. Les extensions qui contiennent du code relèvent du SDK
d'extensions ([EXTENSION_SDK.md](EXTENSION_SDK.md)) et restent réservées au mode développeur.

Il n'y a pas de place de marché. Un plugin s'importe depuis un fichier local, dans le Control
Center → Connecteurs MCP → Plugins. Noon affiche alors son contenu (serveurs, adresses, consigne),
et rien n'est envoyé avant ta confirmation.

Prérequis : le flag `connectors.mcp`, désactivé par défaut.

## Format `noon.plugin/1`

```json
{
  "schema": "noon.plugin/1",
  "id": "outils-equipe",
  "name": "Outils équipe",
  "version": "1.0.0",
  "description": "Tickets et documentation de l'équipe.",
  "instructions": "Pour une question sur un ticket, cherche d'abord dans la documentation.",
  "mcpServers": [
    { "key": "tickets", "displayName": "Tickets", "url": "https://mcp.tickets.example/mcp" },
    { "key": "docs", "displayName": "Docs", "url": "https://mcp.docs.example/mcp" }
  ]
}
```

| Champ | Règle |
| --- | --- |
| `schema` | Toujours `noon.plugin/1`. |
| `id` | 3 à 41 caractères : minuscules, chiffres et tirets, en commençant par une lettre. |
| `name` | 60 caractères au plus. |
| `version` | Format `x.y.z`. |
| `description` | Facultatif, 300 caractères au plus. |
| `instructions` | Facultatif, 1 500 caractères au plus. |
| `mcpServers` | 1 à 5 serveurs, chacun avec `key` (unique), `displayName` et `url`. |

Les règles d'adresse sont celles d'un serveur ajouté par URL :
- HTTPS, ou loopback en HTTP ;
- pas d'identifiant dans l'URL, pas de fragment ;
- aucun paramètre qui ressemble à un secret (`key`, `token`, `secret`, `auth`…). La connexion
  passe par l'autorisation OAuth du serveur.

Un champ inconnu fait refuser tout le plugin.

## Ce qu'un plugin ne peut pas faire

- Exécuter du code, ou lancer un serveur sur le Mac.
- Déclarer des outils en lecture seule, ou cocher des outils d'écriture. Après l'installation, tu
  valides chaque outil toi-même, comme pour tout serveur ajouté par URL. Chaque écriture demande
  ensuite ta confirmation exacte dans le chat.
- Modifier les règles de Noon : sa consigne est présentée au modèle comme venant de
  l'utilisateur et subordonnée aux règles, aux validations et aux limites de Noon.

## Installer, mettre à jour, désinstaller

- **Installer** : tout ou rien. Si un serveur est refusé (doublon, limite de 10 serveurs ajoutés
  par URL), aucun n'est ajouté.
- **Mettre à jour** : désinstalle puis réinstalle la nouvelle version.
- **Désinstaller** : retire ses serveurs, leurs jetons locaux et leurs outils validés.
- **Stockage** : `mcp-plugins.json`, dans le dossier de données de Noon. Il est relu et revalidé au
  démarrage, et un plugin modifié à la main de façon invalide est ignoré.
