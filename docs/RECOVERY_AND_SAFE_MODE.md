# Récupération, données et mode sûr

## Données et migrations

Le chemin canonique est le `userData` Electron. La migration legacy copie d'abord les JSON valides vers `migration-backup`, conserve les originaux et valide la copie avant utilisation. Les migrations structurées restent la responsabilité de `MigrationManager` et `UpdateRecoveryEngine`. Toute validation de release avec données existantes doit se faire sur une copie, jamais sur l'unique profil utilisateur.

## Arrêt et crash

`startup-state.json` est écrit atomiquement avec les états `starting`, `running` et `clean`. Un état `starting` ou `running` au lancement suivant signale un arrêt non propre dans les logs. Il ne déclenche aucun rejeu automatique d'effet de bord. Jobs, transactions, approbations et synchronisation conservent leurs propres états canoniques ; `UNKNOWN_OUTCOME` doit rester bloqué pour décision humaine.

À la fermeture d'une fenêtre, Noon reste actif dans la barre de menu. « Quitter complètement Noon » arrête wake word, timers, raccourcis, tray, jobs et serveur local. Après un Quit complet, « Salut Noon » ne peut pas fonctionner puisqu'aucun processus n'écoute.

## Sleep et wake

Sur `suspend`/verrouillage, la voix live et le wake word sont arrêtés. Sur reprise/déverrouillage, le wake word est reprogrammé selon la préférence et le brief du jour est contrôlé. Cette logique doit encore être validée manuellement sur le paquet signé.

## Mode sûr

```bash
npm run start:safe
```

ou, pour un binaire packagé :

```bash
/Applications/Noon.app/Contents/MacOS/Noon --safe-mode
```

Le mode sûr désactive wake word, brief planifié et démarrage du moteur de jobs, tout en conservant le serveur local et les diagnostics. Il ne répare ni ne supprime aucune donnée. Les extensions et connecteurs restent soumis à leurs feature flags et politiques ; le mode sûr n'est pas une autorisation de contourner la sécurité.

## Sauvegarde et restauration

Avant mise à jour : vérifier les sauvegardes via `UpdateRecoveryEngine`, puis appliquer migrations et vérifications. En cas d'échec, restaurer uniquement depuis une sauvegarde validée. Ne jamais remplacer silencieusement une base illisible par une base vide. L'auto-update est désactivé tant qu'un canal signé, notarized et rollbackable n'est pas disponible.
