# Validation UI Electron isolée

Le mode est destiné à ouvrir Noon afin de contrôler l'interface et les règles DEV avec un profil synthétique, sans toucher au profil personnel.

```sh
node scripts/start-ui-validation.js
```

Cette commande prépare, puis lance Forge avec exactement `npm start -- -- --noon-ui-validation-profile=/private/tmp/noon-ui-validation-profile-fb250a2`. Elle n'accepte aucun chemin en argument : le profil fixe et les deux fixtures A/B sont les seules cibles possibles. Elle refuse les symlinks, redirections, fichiers à la place de dossiers ou un profil existant non marqué, et ne vide ni n'écrase un contenu existant. Une seconde ouverture du même profil est arrêtée par le verrou d'instance Electron.

Au lancement, le bootstrap crée uniquement s'ils sont absents les quatre dossiers fermés suivants : le profil isolé, le parent commun des fixtures, `Projet synthétique A` et `Projet synthétique B`. Le profil reste absolu et ne peut être ni le `userData` normal, ni son parent, ni son enfant. Ces comparaisons utilisent les chemins réels : un symlink ne les contourne pas. Le flag ne peut être donné qu'une fois. Le démarrage échoue sinon ; il n'existe aucun repli vers le profil personnel.

Un répertoire existant n'est jamais présumé synthétique. À la première utilisation, il doit être vide (hormis `.DS_Store`) : Noon y écrit alors le marqueur `.noon-ui-validation-profile.json`. À la réouverture, ce marqueur valide est obligatoire. Le mode ne lit ni ne vide un autre profil.

Avant la composition du serveur, Noon applique ce répertoire à Electron `userData` et à `NOON_DATA_DIR`. Le mode ignore `.env`, efface les identifiants fournisseur/Google/voix hérités de l'environnement, n'ouvre pas SafeStorage ni les migrations de données historiques, et force `LOCAL_ONLY` avec les jobs réseau suspendus.

L'UI et HTTP sur `127.0.0.1` restent disponibles. Les fournisseurs OpenAI/Gemini, recherche publique, Google, Apple Automation, connexions de connecteurs, realtime, ouverture d'URL externe et endpoints DEV HTTP répondent par une limitation explicite ou restent suspendus. Le terminal DEV, l’agent, les commandes et Source Control restent bloqués, avec une explication dans l’UI.

Le profil isolé initialise uniquement deux contextes persistants, sans démarrer de terminal : `Projet synthétique A` et `Projet synthétique B`. Ils correspondent exclusivement aux fixtures réelles configurées côté main sous `/private/tmp/noon-ui-validation-projects-fb250a2/`. Chaque chemin est vérifié avec `lstat` et `realpath` ; un symlink, un chemin absent ou redirigé arrête le démarrage. Le renderer sélectionne seulement l’un des deux `workspaceId` renvoyés par le main et ne transmet aucun chemin local. Le panneau **Règles** permet alors créer, modifier, désactiver, réactiver et supprimer avec les confirmations, versions et la relecture en cas de changement de projet existants. Les données et règles restent dans le profil isolé, avec des identités stables à la réouverture ; aucun projet personnel n’est découvert ou importé.

Ce mode ne remplace pas une sandbox de processus : les parcours locaux explicitement disponibles pour l'UI restent dans le processus Noon.

Ce flag est distinct de `NOON_SMOKE_TEST` : il ne déclenche pas l'auto-quit du smoke. Le smoke et le démarrage normal conservent leurs paramètres habituels.
