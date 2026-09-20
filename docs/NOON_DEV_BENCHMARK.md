# Noon DEV benchmark

Le schéma v15 et BenchmarkArmingRepository fournissent la persistance locale des
armements : recherche de l’armement actif, règle d’un seul armement actif,
transitions persistées, états terminaux, liaison à une session et récupération
des armements actifs.

Cette couche n’accorde encore aucune autorisation d’exécution et ne modifie
aucun feature flag.

BenchmarkArmingService ajoute la création persistante d’un armement pilote avec
une politique serveur fixe : suite `benchmark-suite-v1`, participants
`NATIVE_NOON` et `CODEX`, plafond dédié de 0,50 USD et TTL pending de 20 minutes.
Il capture en lecture seule l’état runtime précédent, permet un désarmement
explicite et inspecte les armements persistés au redémarrage. Un armement pending
stale est expiré ; un armement lié reste récupérable.

Cette phase A2 n’active pas l’exécution benchmark, ne modifie aucun flag runtime
et ne reprend jamais automatiquement une exécution après redémarrage.

La phase B1 lie atomiquement un armement valide à la préparation : validation de
l’armement, création de la session, persistance du plan canonique de huit runs et
liaison de la session à l’armement partagent une unique transaction SQLite. Tout
échec annule l’ensemble, et une seconde préparation vérifie l’intégrité de la
liaison persistée avant de retourner la session existante.

B1 n’autorise toujours aucune exécution benchmark et ne modifie aucun flag.

La phase B2 persiste dans RuntimeConfig une autorisation `BENCHMARK_LIMITED`
bornée à une session préparée, un workspace réel et les quatre fixtures du
registre canonique. Cette autorisation projette atomiquement les flags benchmark
et Native nécessaires, conserve leur configuration précédente exacte, puis la
restaure à la révocation ou à l’expiration. Au redémarrage, l’enregistrement
persistant est la source de vérité et la projection runtime n’est rétablie
qu’après revalidation de la session, du TTL, du workspace et des fixtures.

L’éligibilité Native et Codex reste séparée et purement décisionnelle : B2 ne
lance aucun run, participant ou appel provider.

## Clôture d’ingénierie V2.8

La passe B19I a corrigé le rejet `TARGET_OUT_OF_SCOPE` qui empêchait le chemin
Codex benchmark d’atteindre le spécialiste : le workspace benchmark autorisé est
désormais propagé de façon temporaire et bornée au `DevDelegationRunner`.

La passe B19L a corrigé la découverte du binaire Codex dans l’application macOS
packagée, dont le `PATH` Electron peut être réduit. Le résolveur canonique
préserve le `PATH` validé puis découvre génériquement une installation Codex
supportée dans VS Code. Il canonicalise le candidat, vérifie qu’il est un
fichier exécutable et impose le confinement dans les racines approuvées. Aucun
chemin utilisateur, version d’extension ou exécutable fourni par une tâche,
un prompt ou un workspace n’est accepté.

La régression finale V2.8 est de 1415/1415 tests passants. Le package macOS
x86_64 installé a été comparé au build : les deux `app.asar` ont le SHA-256
`94269003acfa87341620fbc9f294318bf9f54f7b881bc82c974d32b156f4ffc5`.
Le profil réel a atteint `CORE_READY` et `ALIVE`; SQLite est `HEALTHY`, son
intégrité est valide, et le control plane authentifié en lecture seule a
confirmé `benchmark-suite-v1`, ses quatre tâches et ses huit runs canoniques.

Le contrôle de découverte packagé rapporte `codex.available: true`. La source
gagnante exacte (`PATH` ou extension VS Code) n’est volontairement pas exposée
par les API de lecture seule existantes : c’est une limite d’observabilité, pas
un échec fonctionnel. Le scénario déterministe `PATH` réduit avec installation
VS Code supportée est couvert hors ligne.

La fondation Native DEV est prête pour un usage interne. Le chemin de délégation
Codex est implémenté et validé hors ligne, mais son spawn réel après B19L n’est
pas prouvé. Aucun autre probe Codex et aucun pilot comparatif de huit runs ne
sont autorisés pour V2.8; aucune conclusion Noon-versus-Codex ne doit être
tirée.
