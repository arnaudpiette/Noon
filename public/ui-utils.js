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

  function shouldConvertPastedText(value, threshold = 12_000) {
    return typeof value === "string" && value.length > threshold;
  }

  function createPastedTextFileName(date = new Date()) {
    const timestamp = date.toISOString().replace(/[:.]/g, "-");
    return `texte-colle-${timestamp}.txt`;
  }

  function maskPrivateMemoryValue(value) {
    return String(value || "").trim() ? "••••••••••••" : "••••••";
  }

  function privateMemoryCategoryLabel(value) {
    const category = String(value || "").trim();
    return category || "Autres";
  }

  // No HTML parsing: all provider text becomes text nodes, including links and tags.
  function renderBriefMarkdown(container, value) {
    const doc = container.ownerDocument;
    container.replaceChildren();
    function inline(parent, text) {
      const pattern = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
      let offset = 0;
      for (const match of text.matchAll(pattern)) {
        parent.append(doc.createTextNode(text.slice(offset, match.index)));
        const node = doc.createElement(match[1] ? "strong" : "em");
        node.textContent = match[1] || match[2];
        parent.append(node);
        offset = match.index + match[0].length;
      }
      parent.append(doc.createTextNode(text.slice(offset)));
    }
    let list = null;
    let paragraph = null;
    for (const line of String(value || "").split(/\r?\n/)) {
      if (!line.trim()) { list = null; paragraph = null; continue; }
      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      const item = line.match(/^\s*(?:([-*])|([0-9]+)\.)\s+(.+)$/);
      if (heading) {
        const node = doc.createElement(`h${heading[1].length}`);
        inline(node, heading[2]); container.append(node); list = null; paragraph = null;
      } else if (item) {
        const tag = item[1] ? "ul" : "ol";
        if (!list || list.tagName.toLowerCase() !== tag) {
          list = doc.createElement(tag);
          if (tag === "ol") list.start = Number(item[2]);
          container.append(list);
        }
        const node = doc.createElement("li"); inline(node, item[3]); list.append(node); paragraph = null;
      } else {
        list = null;
        if (!paragraph) { paragraph = doc.createElement("p"); container.append(paragraph); }
        else paragraph.append(doc.createTextNode("\n"));
        inline(paragraph, line);
      }
    }
  }

  return {
    escapeHtml,
    parseFocusCommand,
    shouldConvertPastedText,
    createPastedTextFileName,
    maskPrivateMemoryValue,
    privateMemoryCategoryLabel,
    renderBriefMarkdown,
  };

});
