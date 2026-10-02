// Gestion UI bornée des règles DEV : le texte reste du texte, et toute écriture
// passe par le pont IPC de confiance après une action explicite.
(function attachDevProjectRulesUi(global) {
  function messageFor(error) {
    const code = String(error?.code || "");
    if (code === "RULE_MUTATION_REFUSED") return "Cette règle a changé. Relis les règles avant de réessayer.";
    if (code === "RULE_MUTATION_STORAGE_UNAVAILABLE") return "Le stockage actuel est en lecture seule : aucune règle ne peut être modifiée.";
    if (code === "DEV_PROJECT_UNRESOLVED") return "Le projet DEV n’est plus résolu. Recharge le workspace.";
    if (code === "DEV_PROJECT_CHANGED") return "Le projet DEV a changé. Relis les règles avant toute action.";
    return "Cette action sur les règles DEV est indisponible.";
  }

  function createDevProjectRulesController({ elements, bridge, getContext, confirmAction = global.confirm } = {}) {
    const state = { rules: [], projectId: null, contextKey: null, workspaceId: null, projectName: "Projet DEV", readOnly: true, readAvailable: false, serial: 0, editing: null };
    const canUseIpc = () => typeof bridge?.getDevProjectRules === "function" && typeof bridge?.devProjectRule === "function";
    const contextValid = (context) => context && context.workspaceId === state.workspaceId && context.contextKey === state.contextKey;
    const setStatus = (text, kind = "idle") => { elements.status.textContent = text; elements.status.dataset.state = kind; };

    function render() {
      elements.project.textContent = state.projectName;
      elements.list.replaceChildren();
      const fragment = document.createDocumentFragment();
      for (const rule of state.rules) {
        const item = document.createElement("article"); item.className = "dev-project-rule"; item.dataset.status = rule.status;
        const text = document.createElement("p"); text.textContent = rule.text;
        const meta = document.createElement("span"); meta.textContent = `${rule.status === "ACTIVE" ? "Active" : "Inactive"} · ce projet · v${rule.version}`;
        const actions = document.createElement("div"); actions.className = "dev-project-rule-actions";
        const edit = document.createElement("button"); edit.type = "button"; edit.textContent = "Modifier"; edit.disabled = state.readOnly;
        edit.addEventListener("click", () => beginEdit(rule));
        const disable = document.createElement("button"); disable.type = "button"; disable.textContent = "Désactiver"; disable.disabled = state.readOnly || rule.status !== "ACTIVE";
        disable.addEventListener("click", () => void mutate("disable", rule));
        const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Supprimer"; remove.disabled = state.readOnly;
        remove.addEventListener("click", () => void mutate("delete", rule));
        actions.append(edit, disable, remove); item.append(text, meta, actions); fragment.append(item);
      }
      if (state.readAvailable && !state.rules.length) { const empty = document.createElement("p"); empty.className = "dev-project-rules-empty"; empty.textContent = "Aucune règle pour ce projet."; fragment.append(empty); }
      elements.list.append(fragment);
      elements.form.hidden = state.readOnly;
      elements.add.disabled = state.readOnly;
      elements.readOnly.hidden = !state.readOnly;
      if (state.readOnly) elements.readOnly.textContent = canUseIpc() ? "Lecture seule : le stockage transactionnel n’est pas disponible." : "Lecture seule : cette surface requiert l’application Noon avec IPC.";
    }

    function resetEditor() { state.editing = null; elements.input.value = ""; elements.save.textContent = "Créer la règle"; elements.preview.textContent = "Saisis une règle ; elle ne sera pas enregistrée automatiquement."; }
    function beginEdit(rule) { state.editing = { ruleId: rule.ruleId, version: rule.version }; elements.input.value = rule.text; elements.save.textContent = "Enregistrer la modification"; updatePreview(); elements.input.focus(); }
    function updatePreview() { const text = String(elements.input.value || "").trim(); elements.preview.textContent = text ? `Aperçu pour ${state.projectName} : ${text}` : "Saisis une règle ; elle ne sera pas enregistrée automatiquement."; }

    async function refresh(context = getContext()) {
      state.serial += 1; const serial = state.serial;
      state.workspaceId = context?.workspaceId || null; state.contextKey = context?.contextKey || null; state.projectName = context?.projectName || "Projet DEV";
      resetEditor();
      state.readAvailable = false;
      if (!context?.workspaceId) { state.rules = []; state.readOnly = true; setStatus("Sélectionne un projet DEV."); render(); return; }
      if (!canUseIpc()) { state.rules = []; state.readOnly = true; setStatus("IPC indisponible : les règles ne peuvent pas être lues.", "error"); render(); return; }
      setStatus("Lecture des règles…", "running"); render();
      try {
        const result = await bridge.getDevProjectRules(context.workspaceId);
        if (serial !== state.serial || !contextValid(getContext())) return;
        state.rules = Array.isArray(result?.rules) ? result.rules : [];
        state.projectId = typeof result?.project?.id === "string" ? result.project.id : null;
        if (!state.projectId) throw Object.assign(new Error("Projet DEV non résolu."), { code: "DEV_PROJECT_UNRESOLVED" });
        state.readAvailable = true;
        state.projectName = String(result?.project?.name || state.projectName);
        state.readOnly = result?.storage !== "READ_WRITE";
        setStatus(state.readOnly ? "Règles chargées en lecture seule." : "Règles chargées.", "ready"); render();
      } catch (error) {
        if (serial !== state.serial || !contextValid(getContext())) return;
        state.rules = []; state.projectId = null; state.readAvailable = false; state.readOnly = true; setStatus(messageFor(error), "error"); render();
      }
    }

    async function mutate(action, rule = null) {
      const context = getContext();
      if (state.readOnly || !state.readAvailable || !state.projectId || !contextValid(context)) { setStatus("Le projet a changé. Relis les règles avant toute action.", "error"); return; }
      const writesText = action === "create" || action === "update";
      const text = writesText ? String(elements.input.value || "").trim() : undefined;
      if (writesText && !text) { setStatus("Le texte de règle est requis.", "error"); return; }
      const actionLabel = action === "create" ? "créer" : action === "update" ? "modifier" : action === "disable" ? "désactiver" : "supprimer de cette liste";
      const preview = text || rule?.text || "";
      if (typeof confirmAction === "function" && !confirmAction(`Confirmer : ${actionLabel} cette règle pour « ${state.projectName} » ?\n\n${preview}`)) { setStatus("Action annulée : aucune règle n’a été modifiée."); return; }
      const payload = { action, workspaceId: context.workspaceId, expectedProjectId: state.projectId };
      if (action === "create" || action === "update") payload.text = text;
      if (rule || state.editing) { const target = rule || state.editing; payload.ruleId = target.ruleId; payload.expectedVersion = target.version; }
      setStatus("Enregistrement explicite…", "running");
      try {
        await bridge.devProjectRule(payload);
        if (!contextValid(getContext())) { setStatus("Le projet a changé : relecture requise.", "error"); return; }
        await refresh(context);
      } catch (error) { if (contextValid(getContext())) setStatus(messageFor(error), "error"); }
    }

    elements.toggle.addEventListener("click", () => { const open = elements.panel.hidden; elements.panel.hidden = !open; elements.toggle.setAttribute("aria-expanded", String(open)); if (open) void refresh(); });
    elements.add.addEventListener("click", () => { resetEditor(); elements.input.focus(); });
    elements.input.addEventListener("input", updatePreview);
    elements.cancel.addEventListener("click", () => { resetEditor(); setStatus("Édition annulée : aucune règle n’a été modifiée."); });
    elements.form.addEventListener("submit", (event) => { event.preventDefault(); void mutate(state.editing ? "update" : "create"); });
    return { refresh, reset: () => refresh(null), state };
  }
  global.NoonDevProjectRulesUi = { createDevProjectRulesController };
})(window);
