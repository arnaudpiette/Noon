"use strict";

// V3-L1 — section « Caractère » des réglages : cinq cadrans (docs/ROADMAP.md §1.2).
// Rendu en textContent ; aucune valeur serveur ne devient du HTML ; aucun stockage navigateur.
(function attachCharacterUi(global) {
  const ORDER = ["frankness", "challenge", "initiative", "proactivity", "comfortPush"];

  function createCharacterApi({ fetchImpl }) {
    if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl requis.");
    async function call(method, body) {
      const options = { method, cache: "no-store", headers: {} };
      if (method !== "GET") {
        options.headers["X-Noon-Request"] = "1";
        options.headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(body || {});
      }
      const response = await fetchImpl("/character/dials", options);
      let payload;
      try { payload = await response.json(); } catch { payload = {}; }
      if (!response.ok) throw Object.assign(new Error(String(payload.message || "Réglage impossible.")), { code: String(payload.code || "CHARACTER_ERROR") });
      return payload;
    }
    return Object.freeze({ load: () => call("GET"), save: (dials) => call("POST", { dials }) });
  }

  function createCharacterController({ elements, api, debounceMs = 400, setTimer = global.setTimeout?.bind(global), clearTimer = global.clearTimeout?.bind(global) }) {
    const root = elements?.root;
    if (!root || !api) throw new TypeError("root et api requis.");
    const doc = root.ownerDocument || global.document;
    let state = null;
    let status = null;
    let pending = {};
    let timer = null;

    const el = (tag, className = "", text = null) => { const node = doc.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = String(text); return node; };

    function describe(id, value) {
      const definition = state.definitions[id];
      if (id === "proactivity") return `${value} par jour au maximum`;
      if (value === definition.min) return definition.low;
      if (value === definition.max) return definition.high;
      return `${value}/${definition.max}`;
    }

    async function flush() {
      timer = null;
      const changes = pending; pending = {};
      if (!Object.keys(changes).length) return;
      try {
        const saved = await api.save(changes);
        state = { ...state, dials: saved.dials };
        status = { text: "Enregistré. Noon applique ces réglages dès le prochain message.", kind: "success" };
      } catch (error) {
        status = { text: error.message || "Réglage impossible.", kind: "error" };
      }
      render();
    }

    function change(id, value) {
      state = { ...state, dials: { ...state.dials, [id]: value } };
      pending[id] = value;
      status = null;
      if (timer && clearTimer) clearTimer(timer);
      timer = setTimer ? setTimer(() => { void flush(); }, debounceMs) : null;
      if (!setTimer) void flush();
      render();
    }

    function render() {
      if (!state) { root.hidden = true; return; }
      root.hidden = false;
      const nodes = [el("legend", "", "Caractère")];
      nodes.push(el("small", "setting-help", state.enabled
        ? "Comment Noon te parle et te challenge. Il peut adoucir un réglage s'il te sent fatigué, en le disant ; jamais le durcir sans ton accord."
        : "Charte de caractère désactivée (flag character.charter) : Noon utilise sa personnalité de base."));
      for (const id of ORDER) {
        const definition = state.definitions[id];
        if (!definition) continue;
        const value = state.dials[id];
        const label = el("label", "setting-field character-dial");
        const head = el("span", "character-dial__head");
        const name = el("span", "", definition.label);
        const current = el("span", "character-dial__value", describe(id, value));
        head.append(name, current);
        const input = el("input");
        input.type = "range"; input.min = String(definition.min); input.max = String(definition.max); input.step = "1";
        input.value = String(value); input.disabled = !state.enabled;
        input.setAttribute("aria-valuetext", describe(id, value));
        input.addEventListener("change", () => change(id, Number(input.value)));
        const ends = el("span", "character-dial__ends");
        ends.append(el("span", "", definition.low), el("span", "", definition.high));
        label.append(head, input, ends);
        nodes.push(label);
      }
      if (status) {
        const box = el("small", "setting-help character-status", status.text);
        box.setAttribute("role", status.kind === "error" ? "alert" : "status");
        box.dataset.kind = status.kind;
        nodes.push(box);
      }
      root.replaceChildren(...nodes);
    }

    async function init() {
      try { state = await api.load(); render(); return true; }
      catch { state = null; render(); return false; }
    }

    return Object.freeze({ init, render, flush, state: () => state });
  }

  global.NoonCharacterUi = Object.freeze({ createCharacterApi, createCharacterController });
})(typeof window !== "undefined" ? window : globalThis);
