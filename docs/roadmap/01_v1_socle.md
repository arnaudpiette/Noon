## 2 — V1 historique : le socle complet construit dans la roadmap des 45 étapes

La V1 n’était **pas seulement un chat**. Elle visait déjà un compagnon de travail et de vie personnelle. Les 45 étapes n’étant pas retrouvées individuellement, voici leur couverture fonctionnelle, sans inventer leur numérotation.

### V1-A · Application, navigation, expérience
- App macOS **Electron + Node.js**, fenêtre principale, tray/menu, menu Dock, lancement optionnel à la connexion, instance unique, raccourcis, `noon://wake`, restauration de fenêtre, veille/réveil, app installable.
- Interface de chat texte, streaming progressif, arrêt/réessayer, historique, dossiers de conversations, pièces jointes et recherche dans l’historique.
- Sidebar, modes **Personnel/DA/DEV**, panneau de configuration, intégrations, état de connexion, **Focus** pour les projets, Control Center/états de santé.
- Préservation de l’UI et des interactions existantes dans les évolutions ; éviter les refontes involontaires.
- **État :** socle développé et packaging x64 vérifié à plusieurs reprises ; parcours utilisateur complet packagé et stabilité longue durée non tous attestés.

### V1-B · Voix et réveil
- Voix masculine cohérente, interaction texte + oral sur **la même mémoire et la même sécurité**.
- « **Salut Noon** » via wake word local (Picovoice/Porcupine expérimenté), puis options openWakeWord et macOS Raccourcis/Contrôle vocal.
- STT, TTS, WebRTC/Realtime, mode Live, choix micro, AirPods, interruption, permission microphone, fallback transparent.
- **Décision explicite du 12/10 : Cedar devient la voix principale de Noon** (TTS, Realtime, GPT-Live quand disponibles), jusqu’à disponibilité officielle d’Arbor en API. L’ancien `docs/VOICE_IDENTITY.md` décrit **Marin primaire/Cedar secours** : c’est une divergence à diagnostiquer et corriger. Aucun remplacement silencieux de Cedar ; si le provider impose un fallback de voix, expliquer et demander confirmation. **Arbor ne figure pas dans les voix officiellement documentées des API Live/Realtime au 12/10**.
- **État :** services et tests partiels ; chaîne micro → réponse audible → sommeil/réveil encore à certifier en usage prolongé.

### V1-C · Mémoire et identité
- Mémoire conversationnelle persistante, mémoire longue durée, règles permanentes, préférences utilisateur, **mémoire privée chiffrée**, oubli/correction/confirmer/refuser, anti-injection et provenance.
- Pipeline autonome de candidats, déduplication, mise à jour, expiration, isolation par profil/projet et autorisation d’utilisation ; écran **« Ce que Noon sait de moi »**.
- SQLite local, migrations JSON historiques, WAL, sauvegarde/recovery et migration non destructive.
- **État :** moteurs, migrations, tests de persistance et règles implantés ; vérité en usage réel/backup-restauration à vérifier périodiquement.

### V1-D · Assistant personnel, intégrations et organisation
- **Apple Notes, Rappels, Siri/Raccourcis**, Google **Gmail/Calendar/Drive/Contacts**, **GitHub** et premiers contrats **Figma** ; lecture contrôlée et séparation explicite lecture/écriture.
- Recherche personnelle unifiée dans conversations, mémoire, fichiers autorisés, notes, rappels, emails, agenda et projets.
- Agenda Europe/Paris, créneaux disponibles, conflits, tâches/rappels, priorités, projets, planning, suivi des actions.
- Contraintes personnelles : Daily Brief à **07:00**, pause **12 h 30–13 h 30**, créneaux autorisés, pas de modification externe sans instruction.
- **État :** contrats et fonctions multiples ; connecteurs Gmail/Calendar/Notes/Reminders observés réels ponctuellement en septembre ; authentifications, cas dégradés et actualité des sources à tester au moment de l’usage.

### V1-E · Daily Brief, prévoyance et assistance proactive
- Routine quotidienne unique à 7 h, rattrapage après veille, agenda, mails importants, rappels, projets et recommandations ; composante créative et « vision du lundi ».
- Priorité déterministe, anti-répétition, budget de notifications, feedback utile/inutile, protection des périodes de concentration et restitution des sources manquantes.
- Signaux de projet : absence de prochaine action, échéance proche, blocage, stagnation, estimation dépassée.
- **État :** moteur réel et une preuve de génération packagée historique ; observation à 7 h sur plusieurs jours/veille/reprise **encore ouverte** dans le readiness report.

### V1-F · Outils, recherche, multimodal et productions
- Outils locaux autorisés / Skill Registry, analyse de documents et fichiers, recherche Web sourcée, recherche interne, comparaison multi-sources et synthèse.
- Analyse de fichiers, images, PDF et formats courants via moteurs multimodaux ; ne pas confondre capacités décrites et modèles effectivement testés sur données réelles.
- **Artifact Engine** : génération/versionnement/preview et promotion contrôlée en **MD, HTML, PDF, DOCX, XLSX, PPTX, PNG, RTF, TXT, JSON et CSV** selon le moteur de production ; source et format d’un livrable doivent rester distincts.
- **État :** moteurs et tests de génération présents ; rendu visuel et qualité professionnelle à auditer sur véritables livrables.

### V1-G · Sécurité, autonomie encadrée et qualité
- Hard Rules, Provider Privacy Policy, permissions graduées, approvals à usage unique/temporisées, exactitude du hash cible-contenu, interdiction du rejeu ; moteur d’exécution transactionnel.
- Actions externes en dry-run par défaut ; envoi mail/écriture agenda/Git engageant après aperçu exact et accord. `commit` et `push` séparés ; pas de force-push, reset hard, shell libre ni lecture de `.env`.
- Background Jobs, annulation, idempotence, état durable, reprise contrôlée, diagnostics, observabilité, métriques minimales et production hardening.
- Release x64, tests/lint/build/package, sauvegardes/restauration, modes dégradés, offline et mise à jour/récupération.
- **État :** architecture largement construite et testée ; **V1 « internal alpha » n’est pas synonyme de produit quotidien totalement validé**.

### Les étapes 44 et 45 : ce qu’on peut réellement affirmer
- **Étape 44** : audit de production, packaging x64/DMG/ZIP, durcissement Electron, sécurité et état `INTERNAL_ALPHA_READY` ; rapport historique à 917 tests.
- **Étape 45** : release checklist V1, baseline historique à 923 tests et 109 évaluations ; plusieurs cases restaient ouvertes (matériel audio réel, une exécution du brief à 7 h, installation /Applications, reprise, backup, notarisation, selon version du rapport).
- **Après étape 45** : P1.2, P1.3 Daily Brief, P1.4 connecteurs/Control Center, P1.5 pré-release/installation et observation longue durée ont continué. Les chiffres de tests historiques ne doivent jamais remplacer ceux du dernier HEAD.

