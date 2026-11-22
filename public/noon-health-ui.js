"use strict";

// V3-L6 — panneau « Santé de Noon » (Control Center) : vitesse, coût, réussite, usage du Brief,
// lus depuis GET /api/noon-health. Lecture seule ; rendu en textContent ; aucun stockage
// navigateur. Une mesure absente s'affiche « pas de données », jamais une valeur inventée.
(function attachNoonHealthUi(global) {
  const STATUS = Object.freeze({ OK: ["Dans le budget", "OK"], OVER: ["Hors budget", "ERROR"], NO_DATA: ["Pas de données", "UNKNOWN"] });
  const MODE_LABELS = Object.freeze({ NORMAL: "normal", ECO: "économie", PROTECTION: "protection", BLOCKED: "bloqué" });

  function createNoonHealthApi({ fetchImpl }) {
    if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl requis.");
    return Object.freeze({
      async report(days) {
        const response = await fetchImpl(`/api/noon-health?days=${encodeURIComponent(days)}`, { method: "GET", cache: "no-store" });
        let payload; try { payload = await response.json(); } catch { payload = {}; }
        if (!response.ok || !payload.health) throw Object.assign(new Error("Bilan indisponible."), { status: response.status });
        return payload.health;
      },
    });
  }

  const seconds = (ms) => (ms == null ? "—" : `${(ms / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s`);
  const dollars = (value, digits = 2) => (value == null ? "—" : `${Number(value).toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits })} $`);
  const percent = (value) => (value == null ? "—" : `${Math.round(value * 100)} %`);
  const shortDate = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "numeric", timeZone: "Europe/Paris" });

  function createNoonHealthController({ elements, api }) {
    const root = elements?.root;
    if (!root || !api) throw new TypeError("root et api requis.");
    const doc = root.ownerDocument || global.document;
    let available = false;
    let data = null;
    let days = 7;
    let error = null;

    const el = (tag, className = "", text = null) => { const node = doc.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = String(text); return node; };

    async function refresh() {
      try { data = await api.report(days); error = null; }
      catch (failure) { error = "Bilan de santé indisponible."; if (!data) throw failure; }
      render();
      return data;
    }

    function budgetRow(label, check, format, note) {
      const row = el("li", "noon-health__budget");
      const [text, state] = STATUS[check.status] || STATUS.NO_DATA;
      const pill = el("span", "control-status-pill", text);
      pill.dataset.state = state;
      row.append(el("strong", "", label), doc.createTextNode(" "), pill);
      row.append(el("p", "noon-health__hint", `${format(check.value)} · budget ${format(check.limit)}${note ? ` · ${note}` : ""}`));
      return row;
    }

    function renderBudgets() {
      const card = el("section", "control-card");
      card.append(el("h3", "", "Budgets"));
      const list = el("ul", "noon-health__list");
      list.append(
        budgetRow("Réponse texte (médiane)", data.budgets.textResponse, seconds),
        budgetRow("Premier son en Live (médiane)", data.budgets.voiceFirstAudio, seconds),
        budgetRow("Coût d'aujourd'hui", data.budgets.dailyCost, (value) => dollars(value), "plafond affiché, non bloquant"),
      );
      card.append(list);
      const month = data.month || {};
      if (month.costUSD != null) card.append(el("p", "noon-health__hint", `Mois ${month.month || ""} : ${dollars(month.costUSD)} sur ${dollars(month.budgetUSD, 0)} (mode ${MODE_LABELS[month.mode] || month.mode || "—"}).`));
      return card;
    }

    function renderDays() {
      const card = el("section", "control-card");
      card.append(el("h3", "", "Jour par jour"));
      const table = el("table", "noon-health__table");
      const head = el("tr");
      for (const label of ["Jour", "Échanges", "Réussite", "Texte (médiane)", "Coût"]) head.append(el("th", "", label));
      const thead = el("thead"); thead.append(head);
      const tbody = el("tbody");
      for (const day of [...data.byDay].reverse()) {
        const row = el("tr");
        const detail = [day.text ? `${day.text} texte` : "", day.voice ? `${day.voice} voix` : "", day.background ? `${day.background} auto` : ""].filter(Boolean).join(", ");
        row.append(el("td", "", shortDate(day.date)), el("td", "", day.exchanges ? `${day.exchanges} (${detail})` : "0"), el("td", "", percent(day.successRate)), el("td", "", seconds(day.textP50Ms)), el("td", "", dollars(day.costUSD, 3)));
        tbody.append(row);
      }
      table.append(thead, tbody);
      card.append(table);
      if (!data.totals.exchanges) card.append(el("p", "noon-health__hint", "Aucun échange tracé sur la période : les chiffres se rempliront à l'usage."));
      card.append(el("p", "noon-health__hint", "Le coût par jour est compté depuis l'arrivée de cette mesure ; les jours d'avant restent à « — »."));
      return card;
    }

    function renderBrief() {
      const card = el("section", "control-card");
      card.append(el("h3", "", "Brief"));
      const brief = data.brief;
      if (!brief) { card.append(el("p", "noon-health__hint", "Journal du Brief indisponible.")); return card; }
      card.append(el("p", "", `Sur ${brief.days} jours : généré ${brief.generated} fois, dont ${brief.onTime} à l'heure ; ouvert ${brief.opened} jours. Série en cours : ${brief.openedStreak} jour(s).`));
      return card;
    }

    function render() {
      if (!available || !data) { root.hidden = true; return; }
      root.hidden = false;
      const header = el("header", "control-section__header");
      const title = el("div");
      title.append(el("h2", "", "Santé de Noon"), el("p", "", "Vitesse, coût et réussite, mesurés sur ce Mac. Rien ne quitte le Mac."));
      const select = el("select", "noon-health__period");
      select.setAttribute("aria-label", "Période");
      for (const value of [7, 14, 30]) { const option = el("option", "", `${value} jours`); option.value = String(value); option.selected = value === days; select.append(option); }
      select.value = String(days);
      select.addEventListener("change", () => { days = Number(select.value) || 7; void refresh().catch(() => {}); });
      header.append(title, select);
      const nodes = [header];
      if (error) { const box = el("p", "control-center__notice", error); box.setAttribute("role", "alert"); box.dataset.kind = "error"; nodes.push(box); }
      const totals = el("section", "control-card");
      totals.append(el("h3", "", "Résumé"));
      totals.append(el("p", "", `${data.totals.exchanges} échange(s) tracé(s), réussite ${percent(data.totals.successRate)}. Texte : médiane ${seconds(data.totals.textP50Ms)}, 95 % sous ${seconds(data.totals.textP95Ms)}.`));
      totals.append(el("p", "noon-health__hint", "Taux de correction par toi : pas encore mesuré."));
      nodes.push(totals, renderBudgets(), renderDays(), renderBrief());
      root.replaceChildren(...nodes);
    }

    async function init() {
      try { available = true; await refresh(); return true; }
      catch { available = false; render(); return false; }
    }

    return Object.freeze({ init, refresh, render, isAvailable: () => available });
  }

  global.NoonHealthUi = Object.freeze({ createNoonHealthApi, createNoonHealthController });
})(typeof window !== "undefined" ? window : globalThis);
