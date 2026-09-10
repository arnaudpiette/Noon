"use strict";

const { execFile } = require("child_process");
const { createConnector } = require("./base-connector");

function listRecentNotes(runner = execFile) {
  const script = `tell application "Notes"
set output to ""
set noteItems to notes
set noteCount to count noteItems
repeat with noteIndex from 1 to noteCount
if noteIndex > 50 then exit repeat
set itemRef to item noteIndex of noteItems
set output to output & (id of itemRef) & tab & (name of itemRef) & tab & (plaintext of itemRef) & linefeed
end repeat
return output
end tell`;
  return new Promise((resolve, reject) => runner("osascript", ["-e", script], { timeout: 10_000, maxBuffer: 512 * 1024 }, (error, stdout) => {
    if (error) return reject(Object.assign(new Error("Apple Notes momentanément indisponible."), { status: /-1743|not authorized|not permitted/i.test(String(error.code) + error.message) ? 403 : 503 }));
    resolve(String(stdout).split("\n").filter(Boolean).slice(0, 50).map((line) => {
      const [id, title, ...body] = line.split("\t"); return { id, title, content: body.join(" ").slice(0, 4000) };
    }));
  }));
}

function createAppleNotesConnector(deps) {
  const base = createConnector({ id: "apple-notes", local: true, displayName: "Apple Notes", capabilities: ["recent_notes"], readCapabilities: ["recent_notes"], writeCapabilities: [], scopes: ["macOS Automation: Notes"] }, deps);
  return Object.assign(base, { listRecentNotes: (runner) => base.run(() => listRecentNotes(runner), { idempotent: true, maxRetries: 0 }) });
}

module.exports = { createAppleNotesConnector, listRecentNotes };
