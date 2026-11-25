# Checklist manuelle consolidée

- [ ] Quitter complètement Noon puis relancer `npm start`.
- [ ] Vérifier que Focus contient 22 dossiers et que Noon est entre Lieucommun et Openclassrooms.
- [ ] Vérifier que `/health` indique `dryRunExternalWrites: true`.
- [ ] Ouvrir Intégrations et vérifier qu’aucun token n’est affiché.
- [ ] Configurer les identifiants Google dans `.env`, puis tester lecture Gmail, Calendar, Contacts et Drive.
- [ ] Créer un brouillon Gmail, vérifier la déduplication et confirmer qu’il n’est pas envoyé.
- [ ] Préparer un envoi, modifier le contenu après confirmation et vérifier son refus.
- [ ] Vérifier Calendar en Europe/Paris, un conflit et les transitions heure d’été/hiver.
- [ ] Tester un fichier Drive téléchargeable et un fichier refusant le téléchargement ; vérifier le nettoyage de Temp.
- [ ] Exécuter `gh auth status`, puis tester dépôts, issues, PR et checks en lecture.
- [ ] Vérifier que staging, commit et push demandent trois validations et que force-push est impossible.
- [ ] Configurer Figma OAuth et tester URL, nodes limités, images et fichier inaccessible.
- [ ] Tester « Noon – Rappel » depuis Notes, Siri et le Mac avec/sans date et heure.
- [ ] Tester un brief DA, trois axes, un diagnostic DEV et un mode soutenance.
- [ ] Vérifier qu’une seule routine de brief 07:00 existe et que le lundi est intégré.
- [ ] Générer une production locale et vérifier v001 puis v002 sans écrasement.
- [ ] Désactiver le dry-run uniquement après revue complète des permissions et refaire chaque test d’écriture avec une donnée non sensible.

## Livraisons du 24 et 25/11/2026, à vérifier dans le vrai Noon (`npm start`)

### Interface V3 (étapes 1 à 4)
- [ ] Le picto Réglages ouvre directement le Control Center sur l'onglet Réglages ; Échap le ferme.
- [ ] Le Control Center montre les groupes Aujourd'hui, Intégrations, Mémoire et confidentialité,
      DEV et Système, sans sélecteur « Vue ».
- [ ] Colonne de gauche : un premier clic sur une conversation l'ouvre, y compris la dernière
      conversation au lancement. Vérifier aussi qu'un clic avec un léger mouvement n'est pas pris
      pour un glisser.
- [ ] La pastille de Conversation Live est ronde.
- [ ] Mode DEV avec un projet Focus : chat à gauche, aperçu en haut à droite, terminal en bas à droite.
- [ ] L'aperçu natif (vraie page localhost) s'affiche exactement dans sa zone et suit la poignée.
- [ ] Les boutons Terminal, Aperçu et Modifications de la barre du haut masquent et réaffichent
      les panneaux ; la largeur est retenue après un redémarrage.
- [ ] Ouvrir une conversation d'un projet passé en DEV remet le mode DEV ; une conversation de
      Général garde son propre mode.

### Conversation Live
- [ ] Au lancement de Noon.app : autorisation micro, puis Noon dit « Salut Noon, par quoi on
      commence aujourd'hui ? ».
- [ ] Recharger la fenêtre ne relance pas Live ; réveiller le Mac n'ouvre pas le micro.
- [ ] Avec l'écoute « Salut Noon » activée : Noon ne se réveille pas en s'entendant.
- [ ] Dire « c'est Alexandra » donne la phrase « Cleopatatra » mot pour mot.
- [ ] Dire « c'est Kaan » donne sa phrase. Puis « que t'a dit papa hier ? » et « lis mes mails » :
      Noon refuse gentiment. Dire ensuite « c'est Arnaud » ne lève pas la restriction (il faut
      relancer Live).
- [ ] Réglages → Voix et audio : changer la langue pendant Live s'applique ; vider l'accent
      revient à aucun accent ; décocher le démarrage automatique l'empêche au prochain lancement.

### Connecteurs MCP (flag `connectors.mcp`)
- [ ] Supabase : installer avec l'identifiant d'un **projet de développement**, autoriser,
      valider un outil de lecture, puis le demander à Noon dans le chat.
- [ ] Cocher un outil d'écriture Supabase, le demander dans le chat : la carte montre le serveur,
      l'outil et les arguments exacts. « Refuser » n'envoie rien ; « Confirmer exactement » l'envoie
      une fois.
- [ ] GitHub (MCP officiel) : coller un jeton « fine-grained » en lecture seule. Le champ se vide
      et le jeton n'est jamais réaffiché ; un faux jeton est signalé comme refusé.
- [ ] Ajouter un serveur par URL de confiance. Une adresse contenant `?token=` est refusée.
- [ ] Importer un plugin `noon.plugin/1` (voir `docs/MCP_PLUGINS.md`) : relecture, installation,
      puis désinstallation (ses serveurs disparaissent).

### Charte de caractère (lot V3-L1)
- [x] Noter les 30 cas (fait le 25/11 : 30/30, L1 validé). Commande : `npm run eval:character -- --grade .noon-evals/character/<fichier>.json`.
      Objectif : au moins 90 %.

### Recorder V1 (flag `recorder.v1`)
- [ ] Control Center → Aujourd'hui → Enregistreur : démarrer un enregistrement seul ; le voyant
      rouge apparaît en haut avec la durée.
- [ ] Pause puis Reprendre depuis le voyant : la durée ne compte pas la pause.
- [ ] Arrêter, puis réécouter : l'audio est complet, la partie avant la pause comprise.
- [ ] Cocher « Plusieurs personnes participent » : le démarrage reste impossible tant que la
      case de consentement n'est pas cochée.
- [ ] Quitter Noon pendant un enregistrement, relancer : la session est « interrompue » et se
      réécoute jusqu'au dernier morceau sauvegardé.
- [ ] Sur un enregistrement terminé, « Transcrire avec OpenAI » ouvre l'encadré d'accord ;
      « Annuler » n'envoie rien. « Envoyer à OpenAI et transcrire » donne des passages horodatés
      (environ 0,006 $ par minute).
- [ ] En mode local uniquement, la transcription est refusée avec un message clair.
