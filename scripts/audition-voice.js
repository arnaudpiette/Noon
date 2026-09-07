"use strict";
const { createVoiceIdentity } = require("../services/voice/voice-identity");
const identity = createVoiceIdentity().publicConfig();
console.log(`Voix Noon : ${identity.displayName} — ${identity.statusMessage}. Aucune audition de substitution autorisée.`);
