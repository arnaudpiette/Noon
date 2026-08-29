"use strict";
// Déduplique les alertes automatiques et limite leur fréquence pour éviter les notifications répétées.
const crypto = require("crypto");
function fingerprintAlert(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function shouldNotify(previous, current, now = Date.now()) {
  if (!previous) return true;
  if (current.level === "rouge" && previous.level !== "rouge") return true;
  if (previous.fingerprint !== current.fingerprint) return true;
  return now - Date.parse(previous.notifiedAt) > (current.silenceMs || 24 * 60 * 60 * 1000);
}
module.exports = { fingerprintAlert, shouldNotify };
