"use strict";

// V3-L7 — valeur renvoyée par un module de routes quand la requête ne le concerne pas :
// le gestionnaire de server.js passe alors aux routes suivantes, dans le même ordre qu'avant.
const NOT_HANDLED = Symbol.for("noon.http.not-handled");

module.exports = { NOT_HANDLED };
