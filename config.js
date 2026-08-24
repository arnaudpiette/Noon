// Configuration centrale des espaces locaux accessibles à Noon.
// Ces listes définissent la frontière de sécurité du mode lecture seule.
const path = require("path");
const os = require("os");

const HOME = os.homedir();

// Dossiers racines dans lesquels Noon peut rechercher des projets.
const PROJECT_DIRECTORIES = [
  path.join(HOME, "Noon"),
  path.join(HOME, "Corsaire"),
  path.join(HOME, "Freelance"),
  path.join(HOME, "Lieu commun"),
];

const ALLOWED_DIRECTORIES = [
  ...PROJECT_DIRECTORIES,
  path.join(HOME, "Downloads"),
  path.join(HOME, "Applications"),
  "/Applications",
];

// Espaces affichés en premier dans le sélecteur Focus.
const PRIORITY_DIRECTORIES = [
  path.join(HOME, "Corsaire", "_Openclassrooms"),
  path.join(HOME, "Corsaire", "Website"),
];

// Noms ignorés pendant l’exploration pour protéger les secrets et les performances.
const EXCLUDED_NAMES = [
  ".env",
  ".git",
  ".ssh",
  ".vite",
  ".next",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".Trash",
  "Library",
  ".cache",
];

module.exports = {
  HOME,
  ALLOWED_DIRECTORIES,
  PRIORITY_DIRECTORIES,
  PROJECT_DIRECTORIES,
  EXCLUDED_NAMES,
};
