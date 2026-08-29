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
    if (error) return reject(new Error("Apple Notes momentanément indisponible."));
    resolve(String(stdout).split("\n").filter(Boolean).slice(0, 50).map((line) => {
      const [id, title, ...body] = line.split("\t"); return { id, title, content: body.join(" ").slice(0, 4000) };
    }));
  }));
}

function createAppleNotesConnector(deps) {
  return { ...createConnector({ id: "apple-notes", displayName: "Apple Notes", capabilities: ["recent_notes"], readCapabilities: ["recent_notes"], writeCapabilities: [], scopes: ["macOS Automation: Notes"] }, deps), listRecentNotes };
}

module.exports = { createAppleNotesConnector, listRecentNotes };
