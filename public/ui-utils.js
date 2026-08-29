// Utilitaires partagés pour les rendus HTML construits côté interface.
(function exposeNoonUiUtils(root, factory) {
  const utilities = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = utilities;
    return;
  }

  root.NoonUiUtils = Object.freeze(utilities);
})(typeof globalThis !== "undefined" ? globalThis : window, () => {
  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function parseFocusCommand(value) {
    const question = String(value || "").trim();
    if (/^(?:retire|enlève|désactive|supprime)\s+(?:le\s+)?focus\b/i.test(question)) {
      return { action: "clear", name: null };
    }
    const match = question.match(
      /^(?:(?:mets?|passe|sélectionne|active)\s+(?:le\s+)?)?focus\s+(?:sur|à)\s+(.+?)\s*[.!?]?$/i
    );
    return match
      ? { action: "select", name: match[1].trim() }
      : null;
  }

  return { escapeHtml, parseFocusCommand };
});
