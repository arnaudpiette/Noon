const path = require("path");
const os = require("os");

const HOME = os.homedir();

const ALLOWED_DIRECTORIES = [
  path.join(HOME, "Corsaire"),
  path.join(HOME, "Freelance"),
  path.join(HOME, "Lieu commun"),
];

const PRIORITY_DIRECTORIES = [
  path.join(HOME, "Corsaire", "_Openclassrooms"),
  path.join(HOME, "Corsaire", "Website"),
];

const EXCLUDED_NAMES = [
  ".env",
  ".git",
  ".ssh",
  "node_modules",
  ".Trash",
  "Library",
  ".cache",
];

module.exports = {
  HOME,
  ALLOWED_DIRECTORIES,
  PRIORITY_DIRECTORIES,
  EXCLUDED_NAMES,
};