"use strict";

const fs = require("fs");
const path = require("path");

function createDailyPlanStore(filePath) {
  function load() {
    try {
      const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return value && typeof value === "object" ? value : { version: 1, plans: {} };
    } catch { return { version: 1, plans: {} }; }
  }

  function saveState(state) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, filePath);
  }

  function get(date) { return load().plans?.[date] || null; }
  function save(plan) {
    const state = load();
    state.plans = { ...(state.plans || {}), [plan.date]: plan };
    // Un horizon court suffit et évite l’accumulation de données locales.
    const dates = Object.keys(state.plans).sort().slice(-31);
    state.plans = Object.fromEntries(dates.map((date) => [date, state.plans[date]]));
    saveState(state);
    return plan;
  }

  return { get, load, save };
}

module.exports = { createDailyPlanStore };
