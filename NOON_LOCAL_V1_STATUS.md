# État Noon V1 locale

Dernière vérification : 23 août 2026.

## Terminé

- Application Electron privée x64, bundle `com.arnaudpiette.noon`, serveur limité à `127.0.0.1` et authentification locale.
- Instance unique, fenêtre masquée au bouton rouge, Tray permanent, raccourcis et protocole `noon://wake`.
- Icône Noon source conservée, ICNS et quatre variantes Tray générés.
- Conversation Realtime WebRTC : Mini par défaut (`gpt-realtime-2.1-mini`), Max volontaire, voix `marin`.
- Focus (22 entrées), modes DA, DEV et Soutenance.
- `WakeWordService` local Porcupine/PvRecorder, secret Picovoice chiffré, import privé `.ppn`/`.pv`, sélection micro, sensibilité, anti-répétition et suspension pendant Conversation Live.
- Sécurité Electron : isolation, sandbox, Node désactivé, preload minimal, IPC validés, HTTPS externe seulement et description microphone.
- Actions distantes maintenues derrière une approbation ponctuelle ; aucune écriture distante effectuée pendant la finalisation.
- Installation locale sécurisée préparée avec sauvegarde de l’ancienne application.

## Tests réussis

- `node --check server.js`
- `npm test` : 46/46 tests réussis.
- `npm run lint`
- `npm run build`
- `npm run package` x64.
- `npm run make` : DMG et ZIP générés avec succès avant les deux derniers garde-fous d’interface.
- `npm run verify:mac` : aucun secret/runtime connu dans le paquet.
- Mach-O vérifié `x86_64` ; modules natifs Picovoice macOS x86_64 présents dans `app.asar.unpacked`.
- Empreinte de l’ICNS embarqué identique à `assets/icons/noon.icns`.

## Partiel ou manuel

- Lancement GUI développeur/packagé et ouverture du port local : bloqués dans le bac à sable par l’autorisation d’exécution GUI/réseau local ; à retester sur le Mac hors bac à sable.
- « Salut Noon » réel : code terminé mais non activable sans AccessKey, `.ppn`, `.pv` et autorisation microphone.
- AirPods, veille/déverrouillage, faux positifs, CPU/mémoire au repos et lancement à la connexion exigent un test matériel réel.
- Siri exige la création manuelle du raccourci.
- Google/GitHub/Figma exigent une authentification volontaire.
- Application non signée et non notariée, conformément à l’absence de certificat Apple.
- Installation dans `/Applications` non lancée car elle requiert la confirmation explicite d’Arnaud.

## Versions et artefacts

- Node : 22.23.2
- Electron : 43.4.1
- Architecture : macOS x64
- App : `out/Noon-darwin-x64/Noon.app`
- DMG : `out/make/Noon.dmg` (artefact Forge valide, à reconstruire une dernière fois hors bac à sable pour inclure les deux derniers garde-fous)
- ZIP : `out/make/zip/darwin/x64/Noon-darwin-x64-1.0.0.zip` (synchronisé avec l’application courante)
