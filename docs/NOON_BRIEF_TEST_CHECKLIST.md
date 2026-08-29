# Checklist du brief matinal

## Automatisé

- [x] calcul de 07:00 avant/après l’heure et changements été/hiver ;
- [x] clé quotidienne idempotente ;
- [x] trois priorités maximum et déduplication ;
- [x] refus des chevauchements et de 12:30–13:30 ;
- [x] découpe des tâches longues ;
- [x] signature, titre, couleur et absence d’invités des blocs Noon ;
- [x] résistance aux instructions malveillantes contenues dans les sources ;
- [x] Gmail limité à la lecture et aux brouillons ;
- [x] aucune API réelle appelée par les tests.

## Manuel après reconnexion Google

- [ ] vérifier le consentement `gmail.readonly`, `gmail.compose`, `calendar.readonly` et `calendar.events` ;
- [ ] générer un brief de test et vérifier un bloc Myrtille dans l’agenda cible ;
- [ ] relancer la génération et vérifier l’absence de doublon ;
- [ ] vérifier qu’un brouillon apparaît sans être envoyé ;
- [ ] refuser Automation Notes/Rappels et vérifier que le brief continue ;
- [ ] mettre le Mac en veille autour de 07:00 puis vérifier le rattrapage et la notification unique.
