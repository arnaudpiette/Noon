// Animation autonome du cœur de Noon sur canvas.
// L’IIFE évite d’exposer les variables internes dans window.
(() => {
  const canvas = document.getElementById("noonCanvas");
  const stage = document.getElementById("coreStage");

  if (!canvas || !stage) return;

  // Un canvas secondaire sert à échantillonner la forme avant de placer les particules.
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
    const sphereRadius = Math.min(
      width * (mobile ? 0.3 : 0.245),
      height * 0.34,
      mobile ? 175 : 245
    );
    const fontSize = sphereRadius * 0.48;
    const sphereCenterX = width / 2;
    const sphereCenterY = height / 2;

    sampleCanvas.width = width;
    sampleCanvas.height = height;
    sampleContext.clearRect(0, 0, width, height);
    sampleContext.fillStyle = "#111";
    sampleContext.textAlign = "center";
    sampleContext.textBaseline = "middle";
    sampleContext.font = `900 ${fontSize}px Montserrat, Arial, sans-serif`;
    const letters = [..."NOON"];
    const glyphWidths = letters.map(
      (letter) => sampleContext.measureText(letter).width
    );
    const letterSpacing = fontSize * 0.025;
    const wordWidth =
      glyphWidths.reduce((total, glyphWidth) => total + glyphWidth, 0) +
      letterSpacing * 3;
    const wordStartX = sphereCenterX - wordWidth / 2;
    let letterCursor = wordStartX;

    letters.forEach((letter, index) => {
      const glyphWidth = glyphWidths[index];
      const centerX = letterCursor + glyphWidth / 2;

      if (index === 3) {
        // Signature NOON : le dernier N est inversé horizontalement.
        sampleContext.save();
        sampleContext.translate(centerX, sphereCenterY);
        sampleContext.scale(-1, 1);
        sampleContext.fillText(letter, 0, 0);
        sampleContext.restore();
      } else {
        sampleContext.fillText(letter, centerX, sphereCenterY);
      }

      letterCursor += glyphWidth + letterSpacing;
    });

    const nextParticles = [];

    const spherePointCount = mobile ? 1450 : 3600;
    for (let index = 0; index < spherePointCount; index += 1) {
      // Suite de Fibonacci : nuage régulier sur toute la surface du volume.
      const vertical = 1 - 2 * ((index + 0.5) / spherePointCount);
      const radial = Math.sqrt(Math.max(0, 1 - vertical * vertical));
      const longitude = index * Math.PI * (3 - Math.sqrt(5));
      const shellVariation = randomBetween(0.91, 1.02);
      const sphereX =
        Math.cos(longitude) * radial * sphereRadius * shellVariation;
      const sphereY = vertical * sphereRadius * shellVariation;
      const sphereZ =
        Math.sin(longitude) * radial * sphereRadius * shellVariation;
      const homeX = sphereCenterX + sphereX;
      const homeY = sphereCenterY + sphereY;
      const entryAngle = Math.random() * Math.PI * 2;
      const entryDistance = randomBetween(
        sphereRadius * 0.15,
        sphereRadius * 0.8
      );

      nextParticles.push({
        kind: "sphere",
        layer: "surface",
        sphereCenterX,
        sphereCenterY,
        sphereX,
        sphereY,
        sphereZ,
        homeX,
        homeY,
        x: homeX + Math.cos(entryAngle) * entryDistance,
        y: homeY + Math.sin(entryAngle) * entryDistance,
        vx: 0,
        vy: 0,
        radius: randomBetween(0.45, mobile ? 1.2 : 1.45),
        alpha: randomBetween(0.28, 0.78),
        phase: Math.random() * Math.PI * 2,
      });
    }

    // Halo irrégulier inspiré d'une matière énergétique qui se détache
    // légèrement de la surface principale.
    const haloPointCount = mobile ? 320 : 820;
    for (let index = 0; index < haloPointCount; index += 1) {
      const vertical = randomBetween(-1, 1);
      const radial = Math.sqrt(Math.max(0, 1 - vertical * vertical));
      const longitude = Math.random() * Math.PI * 2;
      const haloRadius = sphereRadius * randomBetween(1.01, 1.17);
      const sphereX = Math.cos(longitude) * radial * haloRadius;
      const sphereY = vertical * haloRadius;
      const sphereZ = Math.sin(longitude) * radial * haloRadius;
      const homeX = sphereCenterX + sphereX;
      const homeY = sphereCenterY + sphereY;

      nextParticles.push({
        kind: "sphere",
        layer: "halo",
        sphereCenterX,
        sphereCenterY,
        sphereX,
        sphereY,
        sphereZ,
        homeX,
        homeY,
        x: homeX + randomBetween(-12, 12),
        y: homeY + randomBetween(-12, 12),
        vx: 0,
        vy: 0,
        radius: randomBetween(0.35, mobile ? 0.9 : 1.1),
        alpha: randomBetween(0.08, 0.34),
        phase: Math.random() * Math.PI * 2,
      });
    }

    particles = nextParticles;
    ambientParticles = [];

    formationProgress = reducedMotion.matches ? 1 : 0;
  }

  function drawCentralWord() {
    const mobile = width < 720;
    const sphereRadius = Math.min(
      width * (mobile ? 0.3 : 0.245),
      height * 0.34,
      mobile ? 175 : 245
    );
    const fontSize = sphereRadius * 0.48;
    const letters = [..."NOON"];

    context.save();
    context.globalAlpha = formationProgress;
    context.globalAlpha = formationProgress * 0.78;
    context.fillStyle = "#050505";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `900 ${fontSize}px Montserrat, Arial, sans-serif`;

    const glyphWidths = letters.map(
      (letter) => context.measureText(letter).width
    );
    const letterSpacing = fontSize * 0.025;
    const wordWidth =
      glyphWidths.reduce((total, glyphWidth) => total + glyphWidth, 0) +
      letterSpacing * 3;
    let cursor = width / 2 - wordWidth / 2;

    letters.forEach((letter, index) => {
      const glyphWidth = glyphWidths[index];
      const centerX = cursor + glyphWidth / 2;

      if (index === 3) {
        context.save();
        context.translate(centerX, height / 2);
        context.scale(-1, 1);
        context.fillText(letter, 0, 0);
        context.restore();
      } else {
        context.fillText(letter, centerX, height / 2);
      }

      cursor += glyphWidth + letterSpacing;
    });

    context.restore();
  }

  function updateParticle(particle, time, delta) {
    if (particle.kind === "sphere") {
      const rotation =
        time * (particle.layer === "halo" ? 0.0005 : 0.00034);
      const cosine = Math.cos(rotation);
      const sine = Math.sin(rotation);
      const pulseAmount = particle.layer === "halo" ? 0.026 : 0.008;
      const pulse = 1 +
        Math.sin(time * 0.0016 + particle.phase) * pulseAmount;
      const rotatedX =
        (particle.sphereX * cosine + particle.sphereZ * sine) * pulse;
      const rotatedZ =
        (-particle.sphereX * sine + particle.sphereZ * cosine) * pulse;
      const verticalRotation = Math.sin(time * 0.00017) * 0.2;
      const turbulence = particle.layer === "halo"
        ? Math.sin(time * 0.0032 + particle.phase) * 5
        : Math.sin(time * 0.0024 + particle.phase) * 0.9;

      particle.homeX =
        particle.sphereCenterX + rotatedX + turbulence;
      particle.homeY =
        particle.sphereCenterY +
        particle.sphereY * Math.cos(verticalRotation) -
        rotatedZ * Math.sin(verticalRotation) +
        Math.cos(time * 0.0028 + particle.phase) *
          (particle.layer === "halo" ? 4 : 0.7);
      particle.depth = rotatedZ / Math.max(
        1,
        Math.hypot(
          particle.sphereX,
          particle.sphereY,
          particle.sphereZ
        )
      );
    }

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
      // La parole fait vibrer les points sans disperser la forme du mot.
      attraction = 0.14;
      noise = 0.035 + audioLevel * 0.08;
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

  function drawSphereParticle(particle, time, vibration) {
    const jitterX = vibration
      ? Math.sin(time * 0.08 + particle.phase) * vibration
      : 0;
    const jitterY = vibration
      ? Math.cos(time * 0.07 + particle.phase) * vibration
      : 0;
    const depthAlpha = 0.72 + (particle.depth || 0) * 0.22;
    const depthScale =
      0.82 + ((particle.depth || 0) + 1) * 0.13;

    context.beginPath();
    context.globalAlpha =
      particle.alpha * formationProgress * depthAlpha;
    context.fillStyle = "#111";
    context.arc(
      particle.x + jitterX,
      particle.y + jitterY,
      particle.radius * depthScale,
      0,
      Math.PI * 2
    );
    context.fill();
  }

  function draw(time) {
    const delta = Math.min(2, Math.max(0.4, (time - lastTime) / 16.67 || 1));
    lastTime = time;
    formationProgress += (1 - formationProgress) * 0.035 * delta;
    context.clearRect(0, 0, width, height);

    for (const dot of ambientParticles) {
      const floatY = Math.sin(time * dot.speed * 0.01 + dot.phase) * 5;
      context.beginPath();
      context.globalAlpha = dot.alpha * formationProgress;
      context.fillStyle = "#111";
      context.arc(dot.x, dot.y + floatY, dot.radius, 0, Math.PI * 2);
      context.fill();
    }

    const vibration = state === "speaking"
      ? 0.65 + audioLevel * 1.35
      : 0;

    particles.forEach((particle) => {
      updateParticle(particle, time, delta);
    });

    // NOON est placé au fond du volume : toute la matière passe devant lui.
    drawCentralWord();

    for (const particle of particles) {
      drawSphereParticle(particle, time, vibration);
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
