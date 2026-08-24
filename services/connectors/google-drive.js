"use strict";

const { createConnector, providerFetch } = require("./base-connector");
function createDriveConnector(deps) {
  const base = createConnector({ id: "google-drive", credentialId: "google", displayName: "Google Drive",
    capabilities: ["search", "metadata", "download", "export", "upload_with_approval"],
    readCapabilities: ["search", "metadata", "download", "export"], writeCapabilities: ["upload", "copy", "update", "delete"],
    scopes: ["https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/drive.file"],
  }, deps);
  const token = () => deps.tokenStore.get("google")?.access_token;
  async function searchDriveFiles(query) {
    const params = new URLSearchParams({ q: `name contains '${String(query).replace(/['\\]/g, "").slice(0, 150)}' and trashed=false`,
      pageSize: "50", fields: "files(id,name,mimeType,size,modifiedTime,capabilities(canDownload))" });
    return providerFetch(`https://www.googleapis.com/drive/v3/files?${params}`, { token: token() });
  }
  async function getDriveFileMetadata(id) {
    return providerFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,modifiedTime,capabilities(canDownload)`, { token: token() });
  }
  function prepareDriveUpload(file) {
    if (!file?.name || !file?.size) throw new Error("Fichier local invalide.");
    if (file.overwrite) throw new Error("L’écrasement distant est refusé par défaut.");
    return { ...file, name: String(file.name).slice(0, 200), destination: file.destination || "root" };
  }
  function previewDriveChange(file) {
    const prepared = prepareDriveUpload(file);
    return deps.approvals.requestApproval({ provider: "google-drive", action: "upload_file", target: prepared.destination,
      payload: prepared, preview: prepared, consequences: "Créera un nouveau fichier sans écraser l’original." });
  }
  async function applyDriveChangeWithApproval(file, approvalId) {
    const prepared = prepareDriveUpload(file);
    deps.approvals.consumeApproval(approvalId, { provider: "google-drive", action: "upload_file", target: prepared.destination, payload: prepared });
    return deps.dryRun ? { dryRun: true, uploaded: false } : Promise.reject(new Error("Upload Drive réel non activé."));
  }
  return { ...base, searchDriveFiles, getDriveFileMetadata,
    downloadDriveFile: getDriveFileMetadata, exportGoogleWorkspaceFile: getDriveFileMetadata,
    prepareDriveUpload, previewDriveChange, applyDriveChangeWithApproval };
}
module.exports = { createDriveConnector };
