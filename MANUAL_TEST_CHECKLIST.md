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
