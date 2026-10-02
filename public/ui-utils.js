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

  function createChatRequestPayload(input = {}) {
    return {
      ...input,
      webSearchEnabled: input.webSearchEnabled === true,
      webSearchForbidden: input.webSearchForbidden === true,
    };
  }

  function maskPrivateMemoryValue(value) {
    return String(value || "").trim() ? "••••••••••••" : "••••••";
  }

  function privateMemoryCategoryLabel(value) {
    const category = String(value || "").trim();
    return category || "Autres";
  }

  function normalizeSafeChatUrl(value) {
    try {
      const url = new URL(String(value || ""));
      if (!new Set(["https:", "http:"]).has(url.protocol) || !url.hostname || url.username || url.password) return null;
      return url.href;
    } catch {
      return null;
    }
  }

  function tokenizeChatMarkdown(value) {
    const text = String(value || "");
    const pattern = /\[([^\]\n]+)\]\(([^)\s]+)\)|https?:\/\/[^\s<>"']+/gi;
    const tokens = [];
    let offset = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index > offset) tokens.push({ type: "text", value: text.slice(offset, match.index) });
      const markdown = match[1] !== undefined;
      let candidate = markdown ? match[2] : match[0];
      let trailing = "";
      if (!markdown) {
        const trimmed = candidate.replace(/[.,!?;:]+$/g, "");
        trailing = candidate.slice(trimmed.length);
        candidate = trimmed;
      }
      const href = normalizeSafeChatUrl(candidate);
      if (href) tokens.push({ type: "link", label: markdown ? match[1] : candidate, href });
      else tokens.push({ type: "text", value: match[0] });
      if (trailing) tokens.push({ type: "text", value: trailing });
      offset = match.index + match[0].length;
    }
    if (offset < text.length) tokens.push({ type: "text", value: text.slice(offset) });
    return tokens;
  }

  // Le contenu modèle reste du texte : seuls des noeuds <a> bornés sont créés.
  function renderChatMarkdown(container, value) {
    const doc = container.ownerDocument;
    const fragment = doc.createDocumentFragment();
    for (const token of tokenizeChatMarkdown(value)) {
      if (token.type === "text") {
        fragment.append(doc.createTextNode(token.value));
        continue;
      }
      const link = doc.createElement("a");
      link.href = token.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = token.label;
      fragment.append(link);
    }
    container.replaceChildren(fragment);
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

  function renderDailyBriefStructured(container, brief) {
    const doc = container.ownerDocument;
    container.replaceChildren();

    if (!brief || typeof brief !== "object") return;

    const array = (value) => Array.isArray(value) ? value : [];
    const safeDate = (value) => {
      if (!value) return null;
      const date = value instanceof Date ? value : new Date(value);
      return Number.isFinite(date.getTime()) ? date : null;
    };
    const time = (value) => {
      const date = safeDate(value);
      if (!date) return null;
      return new Intl.DateTimeFormat("fr-FR", {
        timeZone: "Europe/Paris",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
    };
    const dateLabel = (value) => {
      if (!value) return "";
      const date = safeDate(`${value}T12:00:00Z`);
      if (!date) return String(value);
      const label = new Intl.DateTimeFormat("fr-FR", {
        timeZone: "Europe/Paris",
        weekday: "long",
        day: "numeric",
        month: "long",
      }).format(date);
      return label.charAt(0).toUpperCase() + label.slice(1);
    };

    function card(title, items, renderItem, options = {}) {
      if (!items.length && !options.emptyMessage) return;

      const section = doc.createElement("section");
      section.className = `brief-card${options.accent ? ` brief-card--${options.accent}` : ""}`;

      const heading = doc.createElement("h2");
      heading.textContent = title;
      section.append(heading);

      if (!items.length) {
        const empty = doc.createElement("p");
        empty.className = "brief-card-empty";
        empty.textContent = options.emptyMessage;
        section.append(empty);
        container.append(section);
        return;
      }

      const list = doc.createElement(options.ordered ? "ol" : "ul");
      list.className = "brief-card-list";

      items.forEach((item, index) => {
        const row = doc.createElement("li");
        row.className = "brief-card-item";
        renderItem(row, item, index);
        list.append(row);
      });

      section.append(list);
      container.append(section);
    }

    function primaryText(parent, value) {
      const text = doc.createElement("span");
      text.className = "brief-card-primary";
      text.textContent = String(value || "");
      parent.append(text);
      return text;
    }

    function metaText(parent, value) {
      if (!value) return;
      const meta = doc.createElement("span");
      meta.className = "brief-card-meta";
      meta.textContent = String(value);
      parent.append(meta);
    }

    const hero = doc.createElement("header");
    hero.className = "brief-day-hero";

    const greeting = doc.createElement("h2");
    greeting.textContent = "☀️ Bonjour Arnaud";

    const day = doc.createElement("p");
    day.textContent = dateLabel(brief.date);

    hero.append(greeting, day);
    container.append(hero);

    const calendar = array(brief.calendar);
    const calendarSource =
      brief.sourceStatus?.["google-calendar"] ||
      brief.sourceStatus?.calendar ||
      null;

    if (calendar.length) {
      card("📅 Aujourd’hui", calendar.slice(0, 8), (row, item) => {
        primaryText(row, item.title || "Événement");
        const start = time(item.start);
        const end = time(item.end);
        metaText(row, start && end ? `${start}–${end}` : start || end);
      });
    } else if (calendarSource && !["ready", "ok"].includes(calendarSource)) {
      card("📅 Aujourd’hui", [], () => {}, {
        emptyMessage: "Je ne peux pas confirmer ton agenda aujourd’hui.",
      });
    }

    card(
      "🎯 Tes priorités",
      array(brief.priorities).slice(0, 3),
      (row, item) => {
        primaryText(row, item.title || "Action prioritaire");
        metaText(row, array(item.reasons)[0] || item.priorityLevel || null);
      },
      { ordered: true, accent: "priority" }
    );

    const proposals = array(brief.proposals);
    const confirmedProposals = proposals.filter((item) => item.confirmedSlot === true);

    if (confirmedProposals.length) {
      card("🕳️ Créneaux disponibles", confirmedProposals.slice(0, 3), (row, item) => {
        primaryText(row, item.title || "Action proposée");
        const start = time(item.start);
        const end = time(item.end);
        metaText(row, start && end ? `${start}–${end}` : null);
      }, { accent: "slots" });
    } else if (
      array(brief.scheduledBlocks).some((item) => item.status === "proposed") &&
      brief.dailyPlan?.calendarAvailability !== "confirmed"
    ) {
      card("🕳️ Créneaux disponibles", [], () => {}, {
        emptyMessage: "Je ne peux pas confirmer tes créneaux aujourd’hui.",
      });
    }

    const dayEnd = brief.date ? new Date(`${brief.date}T23:59:59.999Z`) : null;
    const reminders = array(brief.reminders)
      .filter((item) => {
        const due = safeDate(item.dueAt);
        return due && dayEnd && due <= dayEnd;
      })
      .slice(0, 5);

    card("⏰ À ne pas oublier", reminders, (row, item) => {
      primaryText(row, item.title || "Rappel");
      metaText(row, time(item.dueAt));
    });

    const projects = array(brief.projects)
      .filter((item) => item.nextAction || array(item.blockers).length)
      .slice(0, 3);

    card("📌 Projets", projects, (row, item) => {
      primaryText(row, item.project || item.title || item.id || "Projet");
      if (item.nextAction) metaText(row, `Prochaine action : ${item.nextAction}`);
      if (array(item.blockers).length) {
        metaText(row, `Bloqué par : ${item.blockers.join(", ")}`);
      }
    });

    const importantEmailIds = new Set(
      array(brief.priorities)
        .filter((item) => /gmail|email/i.test(String(item.sourceType || item.source || "")))
        .map((item) => String(item.sourceId || item.sourceReference || ""))
        .filter(Boolean)
    );

    const emails = array(brief.emails)
      .filter((item) => !importantEmailIds.size || importantEmailIds.has(String(item.id || "")))
      .slice(0, 3);

    card("✉️ À surveiller", emails, (row, item) => {
      primaryText(row, item.subject || "Message");
      metaText(row, item.from || null);
      if (item.snippet) metaText(row, item.snippet);
    });

    card("💡 Noon te propose", proposals.slice(0, 3), (row, item) => {
      primaryText(row, item.title || "Action proposée");
      if (item.confirmedSlot) {
        const start = time(item.start);
        const end = time(item.end);
        metaText(row, start && end ? `${start}–${end}` : null);
      } else {
        metaText(row, item.reason || null);
      }
    }, { accent: "proposal" });

    card("📆 Demain", array(brief.tomorrow).slice(0, 5), (row, item) => {
      primaryText(row, item.title || item.summary || "Événement");
      metaText(row, time(item.start));
    });

    card("🎨 Veille créative", array(brief.creative).slice(0, 3), (row, item) => {
      primaryText(row, item.title || item);
    });
  }

  return {
    escapeHtml,
    parseFocusCommand,
    shouldConvertPastedText,
    createPastedTextFileName,
    createChatRequestPayload,
    maskPrivateMemoryValue,
    privateMemoryCategoryLabel,
    normalizeSafeChatUrl,
    tokenizeChatMarkdown,
    renderChatMarkdown,
    renderBriefMarkdown,
    renderDailyBriefStructured,
  };

});
