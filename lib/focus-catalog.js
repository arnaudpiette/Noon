"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { isPathInsideRoots } = require("./path-utils");

const HOME = os.homedir();
const C = path.join(HOME, "Corsaire");
const O = path.join(C, "_Openclassrooms");
const COURSE = path.join(O, "COURS");
const W = path.join(C, "Website");

const FOCUS_CATALOG = [
  ["app-cig", "App cig", ["app cigarette", "dev app cig"], [path.join(W, "APP cig")]],
  ["applications", "Applications", ["application", "apps"], ["/Applications", path.join(HOME, "Applications")]],
  ["corsaire", "Corsaire", [], [C]],
  ["cours", "Cours", ["course", "courses"], [COURSE]],
  ["dev", "DEV", ["développement", "developpement"], [path.join(C, "DEV"), path.join(HOME, "Freelance", "DEV")]],
  ["freelance", "Freelance", [], [path.join(HOME, "Freelance")]],
  ["lieucommun", "Lieucommun", ["lieu commun"], [path.join(HOME, "Lieu commun")]],
  ["noon", "Noon", ["assistant noon", "projet noon", "application noon", "focus sur noon", "passe sur le projet noon", "travaille sur ton propre code", "ouvre l'assistant noon en mode dev", "ouvre l’assistant noon en mode dev"], [path.join(HOME, "Noon")]],
  ["openclassrooms", "Openclassrooms", ["open classrooms", "_openclassrooms"], [O]],
  ["portfolio", "portfolio", ["portfolio arnaud"], [path.join(W, "Website-arnaudpiette", "Portfolio")]],
  ...Array.from({ length: 8 }, (_, index) => {
    const number = index + 1;
    return [`projet-${number}`, `Projet${number}`, [`projet ${number}`], [path.join(COURSE, `Projet${number}`)]];
  }),
  ["teasfolio", "•Teasfolio", ["teasfolio"], [path.join(HOME, "Freelance", "•Teasfolio"), path.join(HOME, "Freelance", "Teasfolio")]],
  ["telechargement", "Téléchargement", ["téléchargements", "telechargement", "telechargements", "downloads"], [path.join(HOME, "Downloads")]],
  ["website", "Website", ["site web"], [W]],
  ["website-arnaudpiette", "Website-arnaudpiette", ["website arnaudpiette", "site arnaud piette"], [path.join(W, "Website-arnaudpiette")]],
].map(([id, displayName, aliases, candidatePaths]) => ({
  id,
  displayName,
  sortName: displayName.replace(/^•/, ""),
  aliases: [displayName, ...aliases],
  candidatePaths,
}));

function compareFocusEntries(a, b) {
  return a.sortName.localeCompare(b.sortName, "fr", {
    sensitivity: "base",
    numeric: true,
    ignorePunctuation: true,
  });
}

function normalizeFocusLookup(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^•/, "")
    .replace(/\s+/g, "")
    .toLocaleLowerCase("fr");
}

function safelyResolveDirectory(candidatePath, allowedRoots) {
  if (!candidatePath || candidatePath.includes(`..${path.sep}`)) return null;
  const absolutePath = path.resolve(candidatePath);
  if (!isPathInsideRoots(absolutePath, allowedRoots)) return null;
  try {
    if (!fs.statSync(absolutePath).isDirectory()) return null;
    const realPath = fs.realpathSync(absolutePath);
    if (!isPathInsideRoots(realPath, allowedRoots)) return null;
    return realPath;
  } catch {
    return null;
  }
}

function buildFocusCatalog(allowedRoots) {
  return FOCUS_CATALOG
    .map((entry) => {
      const matches = [...new Set(entry.candidatePaths
        .map((candidate) => safelyResolveDirectory(candidate, allowedRoots))
        .filter(Boolean))];
      return {
        ...entry,
        resolvedPath: matches.length === 1 ? matches[0] : null,
        available: matches.length === 1,
        status: matches.length > 1 ? "ambiguous" : matches.length === 1 ? "available" : "missing",
        matches,
      };
    })
    .sort(compareFocusEntries);
}

function findFocusEntry(query, catalog) {
  const lookup = normalizeFocusLookup(query);
  if (!lookup) return null;
  return catalog.find((entry) =>
    entry.id === query || entry.aliases.some((alias) => normalizeFocusLookup(alias) === lookup)
  ) || null;
}

module.exports = {
  FOCUS_CATALOG,
  buildFocusCatalog,
  compareFocusEntries,
  findFocusEntry,
  normalizeFocusLookup,
  safelyResolveDirectory,
};
