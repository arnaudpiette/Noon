"use strict";

// V3-L2a — fenêtre de capture rapide (raccourci global). Entrée enregistre la note dans la
// boîte de réception locale ; Échap ferme. Aucun appel au modèle.
(function attachCapture(global) {
  function createCaptureController({ form, input, status, fetchImpl, closeWindow, setTimer }) {
    let busy = false;
    const show = (text, kind = "info") => { status.textContent = text; status.dataset.kind = kind; };
    async function submit() {
      const text = input.value.trim();
      if (!text || busy) return;
      busy = true; input.disabled = true; show("Enregistrement…");
      try {
        const response = await fetchImpl("/capture", { method: "POST", headers: { "Content-Type": "application/json", "X-Noon-Request": "1" }, body: JSON.stringify({ text, origin: "shortcut" }) });
        let payload;
        try { payload = await response.json(); } catch { payload = {}; }
        if (!response.ok) throw new Error(payload.message || "Note non enregistrée.");
        input.value = ""; show("Noté.", "success");
        setTimer(() => closeWindow(), 600);
      } catch (error) {
        show(error.message || "Note non enregistrée.", "error");
      } finally { busy = false; input.disabled = false; input.focus?.(); }
    }
    form.addEventListener("submit", (event) => { event.preventDefault(); void submit(); });
    input.addEventListener("keydown", (event) => { if (event.key === "Escape") closeWindow(); });
    return Object.freeze({ submit });
  }

  global.NoonCapture = Object.freeze({ createCaptureController });
  const doc = global.document;
  const form = doc?.getElementById?.("captureForm");
  if (form) {
    createCaptureController({
      form, input: doc.getElementById("captureText"), status: doc.getElementById("captureStatus"),
      fetchImpl: global.fetch.bind(global), closeWindow: () => global.close(), setTimer: global.setTimeout.bind(global),
    });
  }
})(typeof window !== "undefined" ? window : globalThis);
