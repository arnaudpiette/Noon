# Modèle de sécurité production

## Frontières Electron

Le renderer est non fiable. `BrowserWindow` impose `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, aucun `webview` et aucun contenu mixte. Les DevTools sont désactivés dans les profils `production` et `release`.

Le preload publie une liste fermée de méthodes Noon. Chaque handler du processus principal passe par `createTrustedIpcRegistrar` : URL exacte `http://127.0.0.1:3000/app`, taille maximale et débit maximal. Il n'expose ni shell arbitraire, ni accès fichier générique, ni base de données, ni secret.

Les navigations sont bloquées. Seules les URL externes HTTPS validées sont confiées au navigateur système. La CSP interdit scripts distants, frames, objets, base URL et connexions hors origine. `style-src 'unsafe-inline'` reste une dette ciblée, nécessaire aux styles inline actuels.

## Serveur local

Le serveur écoute uniquement `127.0.0.1:3000` et refuse un autre bind. Les routes mutantes/non publiques exigent un secret local aléatoire conservé avec `safeStorage` et injecté seulement dans les requêtes vers l'origine Noon. Aucun CORS wildcard n'est émis. Le port fixe peut entrer en conflit : Noon refuse alors de se connecter à un service qui ne répond pas comme Noon.

## Secrets et données

- Clés OpenAI/Picovoice : chiffrées via `safeStorage`, jamais dans le bundle.
- Jetons d'intégration et mémoire privée : stockage utilisateur, chiffrement selon leur service canonique.
- Données runtime : `app.getPath("userData")`, jamais le répertoire de travail.
- Journaux : `<userData>/logs/noon.log`, 512 Kio par fichier, cinq rotations, chemins utilisateur et secrets redacted.
- Le scan de release bloque `.env`, jetons, mémoire de conversation et base personnelle dans le bundle.

## Permissions macOS

| Permission | Besoin | Moment | Si refusée |
| --- | --- | --- | --- |
| Microphone | Conversation vocale / wake word | Au démarrage actuel | Chat écrit disponible, voix indisponible |
| Notifications | Brief et réponses | À l'usage via Electron/macOS | Livraison dans l'interface uniquement |
| Screen Recording | Non | Jamais | Sans effet |
| Accessibility | Non | Jamais | Sans effet |
| Automation | Non | Jamais | Sans effet |
| Files/Folders | Sélection explicite | Dialogue utilisateur | Dossier non ajouté |

Les entitlements effectifs couvrent JIT Electron, mémoire exécutable Electron, entrée audio et réseau client/serveur loopback. Aucun entitlement Automation, Accessibility ou Screen Recording n'est demandé.

## Renderer compromis

Les tests vérifient qu'une origine externe n'atteint aucun handler IPC et ne produit aucun effet. Cela ne remplace pas un pentest : les dialogues de fichier et les actions permises par le preload restent des capacités à auditer à chaque ajout.
