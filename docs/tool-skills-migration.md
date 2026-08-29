# Migration des outils vers les skills Noon

Audit réalisé avant migration : Noon utilise la Responses API du SDK OpenAI 7.5.0, conserve localement l’historique et les `call_id`, et n’utilise ni `previous_response_id` ni l’API Assistants.

| Outil historique | Exécuteur conservé | Permission | Effet | Skill cible |
|---|---|---|---|---|
| `search_files` | `searchFiles` | read | lecture de noms dans les racines autorisées | `skills/files/search-files.js` |
| `read_file` | `readAllowedFile` | read | lecture d’un fichier contrôlé | `skills/files/read-file.js` |
| `browse_directory` | `listDirectory` après validation | read | liste un dossier contrôlé | `skills/files/browse-directory.js` |
| `search_gmail` | `searchAuthorizedGmail` | read, réseau | recherche Gmail sans écriture | `skills/gmail/search-emails.js` |
| `ask_codex` | `runCodexAnalysis` | read | analyse du Focus en bac à sable lecture seule | `skills/codex/analyze-project.js` |
| `create_artifact` | `generateArtifact` | write, ordre explicite | crée un nouveau livrable versionné | `skills/creative/create-artifact.js` |
| `generate_creative_image` | `generateCreativeImage` | external, ordre explicite | crée un aperçu temporaire | `skills/creative/generate-image.js` |

Les trois outils fichiers restent chargés immédiatement. Gmail, Codex et les deux outils créatifs utilisent `defer_loading` lorsque `ENABLE_TOOL_SEARCH` n’est pas égal à `false`. Un refus de compatibilité explicite de l’API déclenche un unique repli vers les mêmes définitions non différées.
