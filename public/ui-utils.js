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

  return { escapeHtml };
});
