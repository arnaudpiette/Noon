"use strict";

function extractWebSources(response) {
  const sourcesByUrl = new Map();

  for (const item of response?.output || []) {
    if (item.type !== "message") continue;

    for (const content of item.content || []) {
      for (const annotation of content.annotations || []) {
        if (
          annotation.type !== "url_citation" ||
          !annotation.url
        ) {
          continue;
        }

        try {
          const url = new URL(annotation.url);

          if (url.protocol !== "https:") {
            continue;
          }

          sourcesByUrl.set(url.href, {
            url: url.href,
            title: annotation.title || url.hostname,
          });
        } catch {
          // Une annotation mal formée n’est jamais transmise au navigateur.
        }
      }
    }
  }

  return Array.from(sourcesByUrl.values()).slice(0, 8);
}

function countWebSearchCalls(response) {
  return (response?.output || []).filter(
    (item) => item.type === "web_search_call"
  ).length;
}

function sanitizeResponseOutputForInput(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeResponseOutputForInput);
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "parsed_arguments")
      .map(([key, entryValue]) => [
        key,
        sanitizeResponseOutputForInput(entryValue),
      ])
  );
}

function isToolSearchCompatibilityError(error) {
  const message = String(error?.message || "").toLowerCase();
  return [400, 404].includes(error?.status) &&
    (message.includes("tool_search") || message.includes("defer_loading"));
}

module.exports = {
  extractWebSources,
  countWebSearchCalls,
  sanitizeResponseOutputForInput,
  isToolSearchCompatibilityError,
};
