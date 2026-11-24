"use strict";

// V3-L7 — fournit à un module de routes uniquement les dépendances qu'il déclare. Chaque
// propriété relit la source à chaque accès (accesseur), comme les objets `{ get x() { … } }`
// que server.js passait auparavant à chaque module : une variable initialisée plus tard au
// démarrage reste visible, et rien n'est lu tant qu'aucune route ne correspond.

function pickDependencies(source, names) {
  const picked = {};
  for (const name of names) {
    if (!(name in source)) throw new TypeError(`Dépendance manquante : ${name}`);
    Object.defineProperty(picked, name, { enumerable: true, get: () => source[name] });
  }
  return Object.freeze(picked);
}

module.exports = { pickDependencies };
