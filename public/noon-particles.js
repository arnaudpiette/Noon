(() => {
  const canvas = document.getElementById("noonCanvas");
  const stage = document.getElementById("coreStage");

  if (!canvas || !stage) return;

  const context = canvas.getContext("2d", { alpha: true });
  const sampleCanvas = document.createElement("canvas");
  const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  let particles = [];
  let ambientParticles = [];
  let state = "idle";
  let audioLevel = 0;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let frameId = null;
  let lastTime = 0;
  let resizeFrame = null;
  let formationProgress = 0;

  const stateLabels = {
    idle: "À l'écoute",
    listening: "Je vous écoute",
    thinking: "Analyse en cours",
    speaking: "Réponse en cours",
  };

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function resizeCanvas() {
    const rect = stage.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    buildParticles();
  }

  function scheduleResize() {
    if (resizeFrame) return;

    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      resizeCanvas();
    });
  }

  function buildParticles() {
    const mobile = width < 720;
    const targetCount = mobile ? 1500 : 4200;
    const fontSize = Math.min(width * (mobile ? 0.23 : 0.22), height * 0.3, 230);

    sampleCanvas.width = width;
    sampleCanvas.height = height;
    sampleContext.clearRect(0, 0, width, height);
    sampleContext.fillStyle = "#111";
    sampleContext.textAlign = "center";
    sampleContext.textBaseline = "middle";
    sampleContext.font = `900 ${fontSize}px Montserrat, Arial, sans-serif`;
    sampleContext.fillText("NOON", width / 2, height / 2);

    const pixels = sampleContext.getImageData(0, 0, width, height).data;
    const textWidth = sampleContext.measureText("NOON").width;
    const textArea = Math.max(1, textWidth * fontSize * 0.68);
    const step = Math.max(2, Math.round(Math.sqrt(textArea / targetCount)));
    const nextParticles = [];

    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const alpha = pixels[(y * width + x) * 4 + 3];

        if (alpha > 90 && Math.random() > 0.08) {
          const homeX = x + randomBetween(-0.55, 0.55);
          const homeY = y + randomBetween(-0.55, 0.55);
          const angle = Math.random() * Math.PI * 2;
          const distance = randomBetween(35, Math.min(width, height) * 0.36);

          nextParticles.push({
            homeX,
            homeY,
            x: homeX + Math.cos(angle) * distance,
            y: homeY + Math.sin(angle) * distance,
            vx: 0,
            vy: 0,
            radius: randomBetween(0.65, mobile ? 1.45 : 1.7),
            alpha: randomBetween(0.68, 1),
            phase: Math.random() * Math.PI * 2,
          });
        }
      }
    }

    particles = nextParticles;
    ambientParticles = Array.from({ length: mobile ? 55 : 110 }, () => ({
      x: randomBetween(width * 0.12, width * 0.88),
      y: randomBetween(height * 0.16, height * 0.84),
      radius: randomBetween(0.45, 1.4),
      alpha: randomBetween(0.12, 0.55),
      speed: randomBetween(0.04, 0.16),
      phase: Math.random() * Math.PI * 2,
    }));

    formationProgress = reducedMotion.matches ? 1 : 0;
  }

  function drawSolidWord(time) {
    const mobile = width < 720;
    const fontSize = Math.min(width * (mobile ? 0.23 : 0.22), height * 0.3, 230);
    const breathing = state === "idle" ? 1 + Math.sin(time * 0.0012) * 0.004 : 1;
    const solidAlpha = state === "speaking" ? Math.max(0.08, 0.72 - audioLevel * 0.65) : 0.92;

    context.save();
    context.translate(width / 2, height / 2);
    context.scale(breathing, breathing);
    context.globalAlpha = solidAlpha * formationProgress;
    context.fillStyle = "#111";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `900 ${fontSize}px Montserrat, Arial, sans-serif`;
    context.fillText("NOON", 0, 0);
    context.restore();
  }

  function updateParticle(particle, time, delta) {
    const centerX = width / 2;
    const centerY = height / 2;
    const dx = particle.x - centerX;
    const dy = particle.y - centerY;
    const distance = Math.max(1, Math.hypot(dx, dy));
    let attraction = 0.105;
    let noise = 0.015;

    if (state === "listening") {
      attraction = 0.085;
      noise = 0.035;
    } else if (state === "thinking") {
      attraction = 0.07;
      noise = 0.09;
    } else if (state === "speaking") {
      attraction = 0.075;
      noise = 0.12 + audioLevel * 0.42;
      const radialForce = (0.06 + audioLevel * 0.55) * delta;
      particle.vx += (dx / distance) * radialForce * randomBetween(0.3, 1);
      particle.vy += (dy / distance) * radialForce * randomBetween(0.3, 1);
    }

    const wave = Math.sin(time * 0.006 + particle.phase);
    particle.vx += (particle.homeX - particle.x) * attraction * delta;
    particle.vy += (particle.homeY - particle.y) * attraction * delta;
    particle.vx += wave * noise * delta;
    particle.vy += Math.cos(time * 0.005 + particle.phase) * noise * delta;
    particle.vx *= Math.pow(0.78, delta);
    particle.vy *= Math.pow(0.78, delta);
    particle.x += particle.vx * delta;
    particle.y += particle.vy * delta;
  }

  function draw(time) {
    const delta = Math.min(2, Math.max(0.4, (time - lastTime) / 16.67 || 1));
    lastTime = time;
    formationProgress += (1 - formationProgress) * 0.035 * delta;
    context.clearRect(0, 0, width, height);

    drawSolidWord(time);

    for (const dot of ambientParticles) {
      const floatY = Math.sin(time * dot.speed * 0.01 + dot.phase) * 5;
      context.beginPath();
      context.globalAlpha = dot.alpha * formationProgress;
      context.fillStyle = "#111";
      context.arc(dot.x, dot.y + floatY, dot.radius, 0, Math.PI * 2);
      context.fill();
    }

    const vibration = state === "speaking" ? audioLevel * 1.7 : 0;

    for (const particle of particles) {
      updateParticle(particle, time, delta);
      const jitterX = vibration ? Math.sin(time * 0.08 + particle.phase) * vibration : 0;
      const jitterY = vibration ? Math.cos(time * 0.07 + particle.phase) * vibration : 0;

      context.beginPath();
      context.globalAlpha = particle.alpha * formationProgress;
      context.fillStyle = "#111";
      context.arc(particle.x + jitterX, particle.y + jitterY, particle.radius, 0, Math.PI * 2);
      context.fill();
    }

    context.globalAlpha = 1;
    frameId = requestAnimationFrame(draw);
  }

  function setNoonState(nextState) {
    if (!stateLabels[nextState]) return;
    state = nextState;
    document.body.dataset.noonState = state;

    const label = document.getElementById("coreStateLabel");
    if (label) label.textContent = stateLabels[state];
  }

  function setAudioLevel(level) {
    audioLevel = Math.max(0, Math.min(1, Number(level) || 0));
  }

  function start() {
    if (!frameId) frameId = requestAnimationFrame(draw);
  }

  function stop() {
    if (frameId) cancelAnimationFrame(frameId);
    frameId = null;
  }

  window.setNoonState = setNoonState;
  window.setAudioLevel = setAudioLevel;

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else {
      lastTime = performance.now();
      start();
    }
  });

  window.addEventListener("resize", scheduleResize);

  // Suit aussi les changements de largeur provoqués par le tiroir latéral.
  // Le canvas conserve ainsi ses proportions pendant toute la transition.
  if ("ResizeObserver" in window) {
    const stageResizeObserver = new ResizeObserver(scheduleResize);
    stageResizeObserver.observe(stage);
  }

  const initialize = async () => {
    if (document.fonts?.ready) await document.fonts.ready;
    resizeCanvas();
    setNoonState("idle");
    start();
  };

  initialize();
})();
