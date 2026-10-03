# Validation UI Electron isolée

Le mode est destiné à ouvrir Noon afin de contrôler l'interface et les règles DEV avec un profil synthétique, sans toucher au profil personnel.

```sh
npm start -- --noon-ui-validation-profile=/chemin/absolu/vers/noon-ui-validation
```

Le répertoire doit déjà exister, être absolu et ne peut être ni le `userData` normal, ni son parent, ni son enfant. Ces comparaisons utilisent les chemins réels : un symlink ne les contourne pas. Le flag ne peut être donné qu'une fois. Le démarrage échoue sinon ; il n'existe aucun repli vers le profil personnel.

Un répertoire existant n'est jamais présumé synthétique. À la première utilisation, il doit être vide (hormis `.DS_Store`) : Noon y écrit alors le marqueur `.noon-ui-validation-profile.json`. À la réouverture, ce marqueur valide est obligatoire. Le mode ne lit ni ne vide un autre profil.

Avant la composition du serveur, Noon applique ce répertoire à Electron `userData` et à `NOON_DATA_DIR`. Le mode ignore `.env`, efface les identifiants fournisseur/Google/voix hérités de l'environnement, n'ouvre pas SafeStorage ni les migrations de données historiques, et force `LOCAL_ONLY` avec les jobs réseau suspendus.

L'UI et HTTP sur `127.0.0.1` restent disponibles. Les fournisseurs OpenAI/Gemini, recherche publique, Google, Apple Automation, connexions de connecteurs, realtime, ouverture d'URL externe et endpoints DEV HTTP répondent par une limitation explicite ou restent suspendus. Les règles DEV pilotées par l'IPC de confiance restent disponibles avec le profil synthétique. Ce mode ne remplace pas une sandbox de processus : les parcours locaux explicitement disponibles pour l'UI restent dans le processus Noon.

Ce flag est distinct de `NOON_SMOKE_TEST` : il ne déclenche pas l'auto-quit du smoke. Le smoke et le démarrage normal conservent leurs paramètres habituels.
