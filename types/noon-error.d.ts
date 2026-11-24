// V3-L0/A.4 : convention de Noon pour les erreurs (vérification de types uniquement, rien n'est
// chargé à l'exécution). Les erreurs portent un code stable et, pour les appels HTTP, un statut.
interface Error {
  code?: string;
  status?: number;
}
