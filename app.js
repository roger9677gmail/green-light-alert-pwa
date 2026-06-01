const $ = (id) => document.getElementById(id);

const APP_VERSION = "2.12.2";
const DEBUG_ENABLED = new URLSearchParams(window.location.search).has("debug");

const YOLO_CONFIG = {
  inputSize: 640,
  intervalMs: 160,
  minConfidence: 0.28,
  modelUrl: "https://huggingface.co/webml/yolov8n/resolve/main/onnx/yolov8n.onnx",
  runtimePath: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/",
  vehicleClassIds: new Set([1, 2, 3, 5, 7]),
};

const els = {
  video: $("camera"),
  stage: document.querySelector(".stage"),
  canvas: $("analysisCanvas"),
  yoloOverlay: $("yoloOverlay"),
  flash: $("flash"),
  demoLight: $("demoLight"),
  contentShell: $("contentShell"),
  shell: document.querySelector(".app-shell"),
  controls: document.querySelector(".controls"),
  stateBadge: $("stateBadge"),
  versionLabel: $("versionLabel"),
  homeVersionLabel: $("homeVersionLabel"),
  launchBtn: $("launchBtn"),
  startBtn: $("startBtn"),
  testBtn: $("testBtn"),
  settingsBtn: $("settingsBtn"),
  aboutBtn: $("aboutBtn"),
  homeBtn: $("homeBtn"),
  updateBtn: $("updateBtn"),
  settingsPanel: $("settingsPanel"),
  aboutPanel: $("aboutPanel"),
  redMeter: $("redMeter"),
  greenMeter: $("greenMeter"),
  stopMeter: $("stopMeter"),
  redValue: $("redValue"),
  greenValue: $("greenValue"),
  stopValue: $("stopValue"),
  message: $("message"),
  sensitivity: $("sensitivity"),
  holdFrames: $("holdFrames"),
  vibrationTolerance: $("vibrationTolerance"),
  soundToggle: $("soundToggle"),
  vibrateToggle: $("vibrateToggle"),
  notifyToggle: $("notifyToggle"),
  demoToggle: $("demoToggle"),
  autoToggle: $("autoToggle"),
};

const state = {
  running: false,
  stream: null,
  rafId: 0,
  audio: null,
  mediaTone: null,
  wakeLock: null,
  audioUnlocked: false,
  reloadingForUpdate: false,
  previousGray: null,
  analysis: {
    width: 0,
    height: 0,
    ctx: null,
  },
  stoppedSince: 0,
  armed: false,
  demoStart: 0,
  alertHoldUntil: 0,
  lastAlertAt: 0,
  armedAt: 0,
  smoothed: { motion: 0, global: 0, lower: 0 },
  baseline: { motion: 0, global: 0, lower: 0, samples: 0 },
  brake: {
    baseline: 0,
    samples: 0,
    lastScore: 0,
    offSince: 0,
    off: false,
    updatedAt: 0,
  },
  fastTarget: {
    baseline: 0,
    samples: 0,
    overSince: 0,
    overKind: "",
    moved: false,
    motion: 0,
    updatedAt: 0,
  },
  stoppedSeconds: 0,
  yolo: {
    session: null,
    loading: false,
    ready: false,
    failed: false,
    inFlight: false,
    lastRunAt: 0,
    latest: null,
    detections: [],
    target: null,
    previousTarget: null,
    missingFrames: 0,
    inputCanvas: null,
    inputCtx: null,
    inputData: null,
    smoothMotion: 0,
    stableSince: 0,
    stillMs: 0,
    locked: false,
    lockedReference: null,
  },
  debug: {
    lastKey: "",
    events: [],
  },
};

const statusText = {
  idle: "待機",
  camera: "相機",
  stable: "停止",
  armed: "待動",
  moving: "移動",
  watching: "監看",
  demo: "模擬",
};

init();

function init() {
  els.versionLabel.textContent = `v${APP_VERSION}`;
  els.homeVersionLabel.textContent = `v${APP_VERSION}`;
  registerServiceWorker();
  detectFeedbackSupport();
  bindControls();
  observeResponsiveLayout();
  setStatus("idle");
  warnIfCameraBlockedByHttp();
}

function bindControls() {
  els.launchBtn.addEventListener("click", async () => {
    showDetector();
    await toggleDetection();
  });
  els.startBtn.addEventListener("click", toggleDetection);
  els.testBtn.addEventListener("click", async () => {
    await unlockAudio();
    triggerAlert("測試提醒", { userGesture: true });
  });
  els.settingsBtn.addEventListener("click", toggleSettings);
  els.aboutBtn.addEventListener("click", toggleAbout);
  els.homeBtn.addEventListener("click", showHome);
  els.updateBtn.addEventListener("click", forceUpdateToLatest);
  els.notifyToggle.addEventListener("change", requestNotificationPermission);
  els.demoToggle.addEventListener("change", () => {
    stopCameraStream();
    resetMotionState();
    setMessage(els.demoToggle.checked ? "模擬模式已開啟，前車會先停止再移動。" : "請固定手機，讓相機看得到前方車輛。");
    updateDemoVisual(performance.now());
  });
  els.autoToggle.addEventListener("change", () => {
    resetMotionState();
    setMessage(
      els.autoToggle.checked
        ? "自動模式會在停止超過設定秒數後進入待提醒。"
        : "自動已關閉，仍需停止達設定秒數後才會待提醒。",
    );
  });

  bindOutsidePanelClose();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.running) {
      requestWakeLock();
    }
  });
}

function showDetector() {
  els.shell.hidden = false;
  document.body.classList.add("detector-active");
  updateLayoutMetrics();
}

function showHome() {
  if (state.running) {
    stopDetection();
  }
  closeSettings();
  closeAbout();
  els.shell.hidden = true;
  document.body.classList.remove("detector-active");
}

function toggleSettings() {
  const shouldOpen = els.settingsPanel.hidden;
  els.settingsPanel.hidden = !shouldOpen;
  els.settingsBtn.setAttribute("aria-expanded", String(shouldOpen));
  els.settingsBtn.textContent = shouldOpen ? "收合設定" : "功能設定";

  if (shouldOpen && !els.aboutPanel.hidden) {
    closeAbout();
  }
}

function toggleAbout() {
  const shouldOpen = els.aboutPanel.hidden;
  els.aboutPanel.hidden = !shouldOpen;
  els.aboutBtn.setAttribute("aria-expanded", String(shouldOpen));
  els.aboutBtn.textContent = shouldOpen ? "關閉" : "關於";

  if (shouldOpen && !els.settingsPanel.hidden) {
    closeSettings();
  }
}

function closeSettings() {
  els.settingsPanel.hidden = true;
  els.settingsBtn.setAttribute("aria-expanded", "false");
  els.settingsBtn.textContent = "功能設定";
}

function closeAbout() {
  els.aboutPanel.hidden = true;
  els.aboutBtn.setAttribute("aria-expanded", "false");
  els.aboutBtn.textContent = "關於";
}

function bindOutsidePanelClose() {
  document.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (els.settingsPanel.hidden && els.aboutPanel.hidden) return;
    if (els.settingsPanel.contains(target) || els.aboutPanel.contains(target)) return;
    if (els.settingsBtn.contains(target) || els.aboutBtn.contains(target)) return;
    closeSettings();
    closeAbout();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeSettings();
    closeAbout();
  });
}

async function forceUpdateToLatest() {
  state.reloadingForUpdate = true;
  setMessage("正在清除快取並檢查最新版。");
  els.updateBtn.disabled = true;
  els.updateBtn.textContent = "更新中";
  const refreshToken = Date.now().toString();

  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        registrations.map(async (registration) => {
          try {
            await registration.update();
            [registration.waiting, registration.installing, registration.active].filter(Boolean).forEach((worker) => {
              activateUpdatedWorker(worker);
            });
          } catch {
            // Keep going; unregistering and cache clearing matter more for a forced refresh.
          }
          return registration.unregister();
        }),
      );
    }

    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    setMessage("更新檢查未完全成功，仍會重新載入嘗試取得最新版。");
  }

  const url = new URL("./index.html", window.location.href);
  url.searchParams.set("v", APP_VERSION);
  url.searchParams.set("refresh", refreshToken);
  url.searchParams.set("nocache", refreshToken);

  window.setTimeout(() => {
    window.location.replace(url.toString());
  }, 250);
  window.setTimeout(() => {
    window.location.assign(url.toString());
  }, 900);
}

function observeResponsiveLayout() {
  const update = () => requestAnimationFrame(updateLayoutMetrics);
  updateLayoutMetrics();

  if ("ResizeObserver" in window && els.controls) {
    const observer = new ResizeObserver(update);
    observer.observe(els.controls);
  }

  window.addEventListener("resize", update);
  window.visualViewport?.addEventListener("resize", update);
  window.addEventListener("orientationchange", update);
}

function updateLayoutMetrics() {
  if (!els.controls || !els.shell) return;

  const controlsHeight = Math.ceil(els.controls.offsetHeight);
  els.shell.style.setProperty("--controls-height", `${controlsHeight}px`);
  renderYoloDetections(state.yolo.detections, state.yolo.target);
}

async function toggleDetection() {
  if (els.shell.hidden) {
    showDetector();
  }

  if (!isCameraSecureContext()) {
    setStatus("idle");
    setMessage("相機需要 HTTPS 才能啟動。請使用 https://9677.fun，或等待 GitHub Pages HTTPS 憑證完成。");
    return;
  }

  if (state.running) {
    stopDetection();
    return;
  }

  state.running = true;
  els.shell.classList.add("running");
  closeSettings();
  closeAbout();
  updateLayoutMetrics();
  resetMotionState();
  if (DEBUG_ENABLED) {
    window.__frontCarDebugLog = [];
    window.__frontCarDebug = null;
    state.debug.lastKey = "";
    state.debug.events = [];
    writeDebugState(null);
  }
  state.lastAlertAt = 0;
  els.startBtn.textContent = "停止偵測";
  const audioReady = await unlockAudio();

  if (!els.demoToggle.checked) {
    try {
      await startCamera();
    } catch (error) {
      state.running = false;
      els.shell.classList.remove("running");
      updateLayoutMetrics();
      els.startBtn.textContent = "前車偵測";
      setStatus("idle");
      setMessage(`相機無法啟動：${error.message || "請確認權限與 HTTPS"}`);
      return;
    }
  }

  await requestWakeLock();
  setStatus(els.demoToggle.checked ? "demo" : "watching");
  if (!els.demoToggle.checked) {
    void prepareYolo();
  }
  if (els.soundToggle.checked && !audioReady) {
    setMessage("音效無法啟用。請確認 iPhone 音量、靜音鍵，或再按一次「測試提醒」。");
  }
  analyzeFrame();
}

async function startCamera() {
  const params = new URLSearchParams(window.location.search);
  const testVideoUrl = params.get("testVideo");
  const testTime = Number(params.get("testTime"));
  const canUseLocalTestVideo =
    testVideoUrl && ["localhost", "127.0.0.1"].includes(window.location.hostname);

  if (canUseLocalTestVideo) {
    els.video.srcObject = null;
    els.video.src = testVideoUrl;
    els.video.loop = true;
    els.video.muted = true;
    els.video.playsInline = true;
    els.video.load();
    await waitForVideoMetadata();
    if (Number.isFinite(testTime) && testTime > 0) {
      els.video.currentTime = testTime;
      await waitForVideoSeek();
    }
    await els.video.play();
    els.demoLight.classList.remove("active");
    setStatus("camera");
    setMessage("本機測試影片已啟動。YOLO 會標出前方車輛並判斷停止/移動。");
    return;
  }

  const constraints = {
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  };

  state.stream = await navigator.mediaDevices.getUserMedia(constraints);
  els.video.srcObject = state.stream;
  await els.video.play();
  els.demoLight.classList.remove("active");
  setStatus("camera");
  setMessage("相機已啟動。YOLO 會標出前方車輛，停穩 5 秒後自動待提醒。");
}

function stopDetection() {
  state.running = false;
  els.shell.classList.remove("running");
  cancelAnimationFrame(state.rafId);
  stopCameraStream();
  releaseWakeLock();
  renderYoloDetections([]);
  els.startBtn.textContent = "前車偵測";
  resetMotionState();
  updateMeters(0, 0);
  setStatus("idle");
  setMessage("監看已停止。");
  updateLayoutMetrics();
}

function stopCameraStream() {
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
  }
  state.stream = null;
  els.video.srcObject = null;
  if (els.video.src) {
    els.video.removeAttribute("src");
    els.video.load();
  }
}

function analyzeFrame(now = performance.now()) {
  if (!state.running) return;

  const metrics = els.demoToggle.checked ? analyzeDemo(now) : analyzeCamera(now);

  if (now < state.alertHoldUntil) {
    setStatus("moving");
    state.rafId = requestAnimationFrame(analyzeFrame);
    return;
  }

  const sensitivity = Number(els.sensitivity.value);
  const stopSeconds = Number(els.holdFrames.value);
  const tolerance = Number(els.vibrationTolerance.value);
  const derived = deriveMotionState(metrics, sensitivity, tolerance);
  updateMeters(derived.stability, derived.frontMotion);
  publishDebugFrame(now, metrics, derived);

  if (!state.armed) {
    learnVibrationBaseline(metrics, tolerance);
    if (derived.isStopped) {
      if (!state.stoppedSince) state.stoppedSince = now;
      const stoppedMs = now - state.stoppedSince;
      updateStopSeconds(stoppedMs / 1000);
      setStatus(stoppedMs >= stopSeconds * 1000 ? "armed" : "stable");
      setMessage(`停止穩定 ${Math.min(stopSeconds, Math.floor(stoppedMs / 1000))}/${stopSeconds} 秒。`);
      if (stoppedMs >= stopSeconds * 1000) {
        state.armed = true;
        state.armedAt = now;
        setStatus("armed");
        setMessage("已待提醒。前車移動時會發出提示。");
      }
    } else {
      state.stoppedSince = 0;
      state.armedAt = 0;
      updateStopSeconds(0);
      setStatus(els.demoToggle.checked ? "demo" : "watching");
      setMessage("監看中。車身或前車尚未穩定停止。");
    }
  } else if (derived.frontCarMoved && (!state.armedAt || now - state.armedAt >= 300)) {
    setStatus("moving");
    triggerAlert("前車移動了");
    state.alertHoldUntil = now + 3200;
    state.armed = false;
    state.armedAt = 0;
    state.stoppedSince = 0;
    updateStopSeconds(0);
  } else {
    setStatus("armed");
    updateStopSeconds(state.stoppedSince ? (now - state.stoppedSince) / 1000 : 0);
    setMessage(`已停止 ${state.stoppedSeconds} 秒，前車移動時會提示。`);
  }

  state.rafId = requestAnimationFrame(analyzeFrame);
}

function analyzeCamera(now = performance.now()) {
  const videoWidth = els.video.videoWidth;
  const videoHeight = els.video.videoHeight;

  if (!videoWidth || !videoHeight) {
    return { stability: 0, motion: 0, globalMotion: 0, lowerMotion: 0 };
  }

  const sampleWidth = 240;
  const sampleHeight = Math.round((sampleWidth / videoWidth) * videoHeight);
  const canvas = els.canvas;
  if (state.analysis.width !== sampleWidth || state.analysis.height !== sampleHeight) {
    canvas.width = sampleWidth;
    canvas.height = sampleHeight;
    state.analysis.width = sampleWidth;
    state.analysis.height = sampleHeight;
    state.analysis.ctx = null;
  }
  const ctx = state.analysis.ctx || canvas.getContext("2d", { willReadFrequently: true });
  state.analysis.ctx = ctx;
  ctx.drawImage(els.video, 0, 0, sampleWidth, sampleHeight);

  const roi = { x: 0, y: 0, w: sampleWidth, h: sampleHeight };

  const frame = ctx.getImageData(0, 0, sampleWidth, sampleHeight).data;
  const gray = toGray(frame, sampleWidth, sampleHeight);
  const metrics = scoreMotion(gray, state.previousGray, sampleWidth, sampleHeight, roi);
  const fastTarget = analyzeLockedTargetMotion(gray, state.previousGray, sampleWidth, sampleHeight, metrics, now);
  const brake = analyzeBrakeLights(frame, sampleWidth, sampleHeight, now);
  state.previousGray = gray;

  if (state.yolo.ready) {
    scheduleYoloFrame(now);
  }

  return mergeYoloMetrics({ ...smoothMotionMetrics(metrics), brake, fastTarget });
}

function waitForVideoMetadata() {
  if (els.video.readyState >= 1) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeout);
      els.video.removeEventListener("loadedmetadata", done);
      els.video.removeEventListener("error", fail);
    };
    const done = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error("測試影片無法載入"));
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("測試影片載入逾時"));
    }, 5000);

    els.video.addEventListener("loadedmetadata", done, { once: true });
    els.video.addEventListener("error", fail, { once: true });
  });
}

function waitForVideoSeek() {
  if (!els.video.seeking) return Promise.resolve();

  return new Promise((resolve) => {
    const timeout = window.setTimeout(resolve, 1200);
    els.video.addEventListener(
      "seeked",
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

function analyzeDemo(now) {
  els.demoLight.classList.add("active");

  if (!state.demoStart) state.demoStart = now;
  const elapsed = now - state.demoStart;
  const moving = elapsed > Number(els.holdFrames.value) * 1000 + 1200;

  updateDemoVisual(moving);
  return moving
    ? { stability: 38, motion: 72, globalMotion: 14 }
    : { stability: 78, motion: 18, globalMotion: 16 };
}

function updateDemoVisual(moving = false) {
  els.demoLight.classList.toggle("active", els.demoToggle.checked);
  els.demoLight.classList.toggle("moving", moving);
}

function toGray(pixels, width, height) {
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
    gray[p] = pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
  }
  return gray;
}

function scoreMotion(gray, previousGray, width, height, roi) {
  if (!previousGray || previousGray.length !== gray.length) {
    return { stability: 0, motion: 0, globalMotion: 0 };
  }

  let globalDiff = 0;
  const total = gray.length;
  for (let i = 0; i < total; i += 1) {
    globalDiff += Math.abs(gray[i] - previousGray[i]);
  }

  const globalMotion = Math.min(100, Math.round((globalDiff / total) * 2.4));
  const roiMotion = scoreRoiMotion(gray, previousGray, width, roi);
  const lowerY = Math.floor(height * 0.58);
  const lowerMotion = scoreRoiMotion(gray, previousGray, width, {
    x: 0,
    y: lowerY,
    w: width,
    h: height - lowerY,
  });
  return {
    stability: Math.max(0, Math.round(100 - Math.max(globalMotion, roiMotion, lowerMotion * 0.86))),
    motion: roiMotion,
    globalMotion,
    lowerMotion,
  };
}

function scoreRoiMotion(gray, previousGray, frameWidth, roi) {
  const cellsX = 8;
  const cellsY = 6;
  const sums = new Float32Array(cellsX * cellsY);
  const counts = new Uint16Array(cellsX * cellsY);

  for (let y = roi.y; y < roi.y + roi.h; y += 1) {
    for (let x = roi.x; x < roi.x + roi.w; x += 1) {
      const frameIndex = y * frameWidth + x;
      const diff = Math.abs(gray[frameIndex] - previousGray[frameIndex]);
      const cx = Math.min(cellsX - 1, Math.floor(((x - roi.x) / roi.w) * cellsX));
      const cy = Math.min(cellsY - 1, Math.floor(((y - roi.y) / roi.h) * cellsY));
      const cell = cy * cellsX + cx;
      sums[cell] += diff;
      counts[cell] += 1;
    }
  }

  const cellScores = [];
  for (let i = 0; i < sums.length; i += 1) {
    if (!counts[i]) continue;
    cellScores.push((sums[i] / counts[i]) * 3.2);
  }

  cellScores.sort((a, b) => b - a);
  const top = cellScores.slice(0, 4);
  const topAverage = top.reduce((sum, value) => sum + value, 0) / top.length;
  return Math.min(100, Math.round(topAverage));
}

function analyzeLockedTargetMotion(gray, previousGray, width, height, metrics, now) {
  const target = state.yolo.lockedReference || state.yolo.target || state.yolo.previousTarget;
  const lockedFrontCar = Boolean(target && (state.yolo.locked || state.armed || state.stoppedSince));

  if (!lockedFrontCar || !previousGray || previousGray.length !== gray.length) {
    resetFastTargetState();
    state.fastTarget.updatedAt = now;
    return { motion: 0, relative: 0, moved: false, updatedAt: now };
  }

  const roi = targetToSampleRoi(target, width, height);
  if (!roi) {
    resetFastTargetState();
    state.fastTarget.updatedAt = now;
    return { motion: 0, relative: 0, moved: false, updatedAt: now };
  }

  const targetStats = scoreTargetMotionSpread(gray, previousGray, width, roi);
  const shiftStats = estimateTargetShift(gray, previousGray, width, height, roi);
  const targetMotion = targetStats.motion;
  const sharedMotion = Math.max(metrics.globalMotion * 0.78, (metrics.lowerMotion || 0) * 0.54);
  const relative = Math.max(0, targetMotion - sharedMotion);
  const canLearn =
    relative <= 11 &&
    targetMotion <= Math.max(18, metrics.globalMotion + 12) &&
    (state.stoppedSince || state.armed || state.yolo.stillMs >= 700);

  if (canLearn) {
    const alpha = state.fastTarget.samples < 5 ? 0.34 : 0.1;
    state.fastTarget.baseline = state.fastTarget.samples
      ? state.fastTarget.baseline * (1 - alpha) + relative * alpha
      : relative;
    state.fastTarget.samples += 1;
  }

  const baselineLimit = state.fastTarget.samples >= 3 ? state.fastTarget.baseline + 9 : 13;
  const threshold = Math.max(12, baselineLimit);
  const broadEnough =
    targetStats.activeCells >= 6 &&
    targetStats.activeRatio >= 0.28 &&
    targetStats.rowSpread >= 2 &&
    targetStats.colSpread >= 3;
  const coherentShift =
    shiftStats.shift >= 1.4 &&
    shiftStats.strength >= 3.2 &&
    shiftStats.coverage >= 0.62 &&
    targetStats.activeCells >= 5 &&
    targetStats.rowSpread >= 2 &&
    targetStats.colSpread >= 2;
  const broadWholeMotion =
    broadEnough &&
    targetStats.activeCells >= 9 &&
    targetStats.activeRatio >= 0.34 &&
    relative >= threshold + 3;
  const canTrigger = state.armed;
  const overKind = coherentShift ? "shift" : broadWholeMotion ? "broad" : "";
  const over =
    canTrigger &&
    (overKind === "shift" || overKind === "broad") &&
    (overKind === "shift" ? relative >= threshold * 0.58 : relative >= threshold + 3) &&
    targetMotion >= Math.max(15, metrics.globalMotion + 5);

  if (over) {
    if (!state.fastTarget.overSince || state.fastTarget.overKind !== overKind) {
      state.fastTarget.overSince = now;
      state.fastTarget.overKind = overKind;
    }
  } else {
    state.fastTarget.overSince = 0;
    state.fastTarget.overKind = "";
  }

  const confirmationMs = state.fastTarget.overKind === "shift" ? 0 : 220;
  state.fastTarget.motion = Math.round(relative);
  state.fastTarget.moved = Boolean(
    state.fastTarget.overSince && now - state.fastTarget.overSince >= confirmationMs,
  );
  state.fastTarget.updatedAt = now;

  return {
    motion: Math.round(relative),
    rawMotion: targetMotion,
    baseline: Math.round(state.fastTarget.baseline),
    activeRatio: targetStats.activeRatio,
    activeCells: targetStats.activeCells,
    shift: shiftStats.shift,
    shiftStrength: shiftStats.strength,
    moved: state.fastTarget.moved,
    updatedAt: now,
  };
}

function targetToSampleRoi(target, width, height) {
  const padX = target.w * 0.12;
  const padY = target.h * 0.1;
  const x = clamp(Math.floor((target.x - padX) * width), 0, width - 1);
  const y = clamp(Math.floor((target.y - padY) * height), 0, height - 1);
  const right = clamp(Math.ceil((target.x + target.w + padX) * width), x + 2, width);
  const bottom = clamp(Math.ceil((target.y + target.h + padY) * height), y + 2, height);
  const w = right - x;
  const h = bottom - y;

  if (w < 8 || h < 8) return null;
  return { x, y, w, h };
}

function scoreTargetMotionSpread(gray, previousGray, frameWidth, roi) {
  const cellsX = 5;
  const cellsY = 4;
  const sums = new Float32Array(cellsX * cellsY);
  const counts = new Uint16Array(cellsX * cellsY);

  for (let y = roi.y; y < roi.y + roi.h; y += 1) {
    for (let x = roi.x; x < roi.x + roi.w; x += 1) {
      const frameIndex = y * frameWidth + x;
      const diff = Math.abs(gray[frameIndex] - previousGray[frameIndex]);
      const cx = Math.min(cellsX - 1, Math.floor(((x - roi.x) / roi.w) * cellsX));
      const cy = Math.min(cellsY - 1, Math.floor(((y - roi.y) / roi.h) * cellsY));
      const cell = cy * cellsX + cx;
      sums[cell] += diff;
      counts[cell] += 1;
    }
  }

  const scores = [];
  let activeCells = 0;
  let activePixels = 0;
  let samplePixels = 0;
  const activeRows = new Set();
  const activeCols = new Set();

  for (let i = 0; i < sums.length; i += 1) {
    if (!counts[i]) continue;
    const score = (sums[i] / counts[i]) * 3.1;
    scores.push(score);
    samplePixels += counts[i];

    if (score >= 13) {
      activeCells += 1;
      activePixels += counts[i];
      activeRows.add(Math.floor(i / cellsX));
      activeCols.add(i % cellsX);
    }
  }

  scores.sort((a, b) => b - a);
  const topCount = Math.min(10, scores.length);
  const topAverage = scores.slice(0, topCount).reduce((sum, value) => sum + value, 0) / Math.max(1, topCount);

  return {
    motion: Math.min(100, Math.round(topAverage)),
    activeCells,
    activeRatio: samplePixels ? activePixels / samplePixels : 0,
    rowSpread: activeRows.size,
    colSpread: activeCols.size,
  };
}

function estimateTargetShift(gray, previousGray, frameWidth, frameHeight, roi) {
  const maxShift = Math.max(2, Math.min(7, Math.round(Math.min(roi.w, roi.h) * 0.08)));
  const step = Math.max(2, Math.round(Math.min(roi.w, roi.h) / 18));
  let baseDiff = 0;
  let baseSamples = 0;
  let bestDiff = Infinity;
  let bestDx = 0;
  let bestDy = 0;
  let bestSamples = 0;

  for (let y = roi.y + maxShift; y < roi.y + roi.h - maxShift; y += step) {
    for (let x = roi.x + maxShift; x < roi.x + roi.w - maxShift; x += step) {
      const i = y * frameWidth + x;
      baseDiff += Math.abs(gray[i] - previousGray[i]);
      baseSamples += 1;
    }
  }

  if (baseSamples < 24) return { shift: 0, strength: 0, coverage: 0, dx: 0, dy: 0 };

  baseDiff /= baseSamples;

  for (let dy = -maxShift; dy <= maxShift; dy += 1) {
    for (let dx = -maxShift; dx <= maxShift; dx += 1) {
      if (!dx && !dy) continue;
      let diff = 0;
      let samples = 0;

      for (let y = roi.y + maxShift; y < roi.y + roi.h - maxShift; y += step) {
        const shiftedY = y + dy;
        if (shiftedY < 0 || shiftedY >= frameHeight) continue;
        for (let x = roi.x + maxShift; x < roi.x + roi.w - maxShift; x += step) {
          const shiftedX = x + dx;
          if (shiftedX < 0 || shiftedX >= frameWidth) continue;
          diff += Math.abs(gray[shiftedY * frameWidth + shiftedX] - previousGray[y * frameWidth + x]);
          samples += 1;
        }
      }

      if (samples && diff / samples < bestDiff) {
        bestDiff = diff / samples;
        bestDx = dx;
        bestDy = dy;
        bestSamples = samples;
      }
    }
  }

  const improvement = Math.max(0, baseDiff - bestDiff);
  return {
    shift: Math.sqrt(bestDx * bestDx + bestDy * bestDy),
    strength: improvement * 2.8,
    coverage: bestSamples / baseSamples,
    dx: bestDx,
    dy: bestDy,
  };
}

function analyzeBrakeLights(pixels, width, height, now) {
  const target = state.yolo.lockedReference || state.yolo.target || state.yolo.previousTarget;
  const lockedFrontCar = Boolean(target && (state.yolo.locked || state.armed || state.stoppedSince));

  if (!lockedFrontCar) {
    resetBrakeLightState();
    state.brake.updatedAt = now;
    return { score: 0, baseline: 0, off: false, updatedAt: now };
  }

  const score = scoreBrakeLightRegion(pixels, width, height, target);
  const canLearnBrake =
    score >= 14 &&
    !state.brake.off &&
    (state.stoppedSince || state.armed || state.yolo.stillMs >= 700);

  if (canLearnBrake) {
    const alpha = state.brake.samples < 4 ? 0.38 : 0.14;
    state.brake.baseline = state.brake.samples
      ? Math.max(score, state.brake.baseline * (1 - alpha) + score * alpha)
      : score;
    state.brake.samples += 1;
  }

  const canDetectOff =
    state.brake.samples >= 3 &&
    state.brake.baseline >= 18 &&
    (state.armed || (state.stoppedSince && now - state.stoppedSince >= 1300));
  const droppedEnough =
    score <= Math.max(8, state.brake.baseline * 0.48) &&
    state.brake.baseline - score >= 10;

  if (canDetectOff && droppedEnough) {
    if (!state.brake.offSince) state.brake.offSince = now;
  } else {
    state.brake.offSince = 0;
  }

  state.brake.lastScore = score;
  state.brake.off = Boolean(state.brake.offSince && now - state.brake.offSince >= 80);
  state.brake.updatedAt = now;

  return {
    score,
    baseline: Math.round(state.brake.baseline),
    off: state.brake.off,
    updatedAt: now,
  };
}

function scoreBrakeLightRegion(pixels, width, height, target) {
  const left = clamp(Math.floor((target.x + target.w * 0.08) * width), 0, width - 1);
  const right = clamp(Math.ceil((target.x + target.w * 0.92) * width), left + 1, width);
  const top = clamp(Math.floor((target.y + target.h * 0.44) * height), 0, height - 1);
  const bottom = clamp(Math.ceil((target.y + target.h * 0.94) * height), top + 1, height);
  let redWeight = 0;
  let redPixels = 0;
  let samples = 0;

  for (let y = top; y < bottom; y += 2) {
    for (let x = left; x < right; x += 2) {
      const i = (y * width + x) * 4;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;
      samples += 1;

      if (max < 54 || delta < 18) continue;

      const sat = delta / max;
      const val = max / 255;
      if (sat < 0.24 || val < 0.18) continue;

      const hue = rgbToHue(r, g, b, max, delta);
      const redHue = hue <= 32 || hue >= 330;
      const redDominant = r >= g * 1.22 && r >= b * 1.12;
      if (!redHue || !redDominant) continue;

      redPixels += 1;
      redWeight += Math.pow(sat, 1.18) * Math.pow(val, 1.08) * 100;
    }
  }

  if (!samples) return 0;

  const averageRed = redWeight / samples;
  const redRatio = redPixels / samples;
  return Math.min(100, Math.round(averageRed * 2.15 + redRatio * 260));
}

function smoothMotionMetrics(metrics) {
  state.smoothed.motion = state.smoothed.motion * 0.62 + metrics.motion * 0.38;
  state.smoothed.global = state.smoothed.global * 0.62 + metrics.globalMotion * 0.38;
  state.smoothed.lower = state.smoothed.lower * 0.62 + (metrics.lowerMotion || 0) * 0.38;
  const motion = Math.round(state.smoothed.motion);
  const globalMotion = Math.round(state.smoothed.global);
  const lowerMotion = Math.round(state.smoothed.lower);

  return {
    stability: Math.max(0, Math.round(100 - Math.max(motion, globalMotion, lowerMotion * 0.86))),
    motion,
    globalMotion,
    lowerMotion,
  };
}

async function prepareYolo() {
  if (state.yolo.ready || state.yolo.loading || state.yolo.failed || els.demoToggle.checked) return;

  state.yolo.loading = true;
  setMessage("正在載入 YOLO 車輛辨識。第一次啟動需要多等一下。");

  try {
    const ortRuntime = await waitForOrtRuntime();
    ortRuntime.env.wasm.wasmPaths = YOLO_CONFIG.runtimePath;
    ortRuntime.env.wasm.numThreads = 1;

    state.yolo.session = await ortRuntime.InferenceSession.create(YOLO_CONFIG.modelUrl, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
    state.yolo.ready = true;
    state.yolo.failed = false;
    setMessage("YOLO 車輛辨識已啟用。畫面會直接標出車輛與機車。");
  } catch {
    state.yolo.failed = true;
    setMessage("YOLO 模型載入失敗，先改用基本移動偵測。請確認網路後重新載入。");
  } finally {
    state.yolo.loading = false;
  }
}

function waitForOrtRuntime() {
  if (window.ort) return Promise.resolve(window.ort);

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (window.ort) {
        window.clearInterval(timer);
        resolve(window.ort);
        return;
      }

      if (Date.now() - startedAt > 9000) {
        window.clearInterval(timer);
        reject(new Error("ONNX Runtime did not load"));
      }
    }, 120);
  });
}

function scheduleYoloFrame(now) {
  if (!state.yolo.session || state.yolo.inFlight) return;
  if (now - state.yolo.lastRunAt < YOLO_CONFIG.intervalMs) return;
  if (!els.video.videoWidth || !els.video.videoHeight) return;

  state.yolo.lastRunAt = now;
  state.yolo.inFlight = true;
  runYoloFrame()
    .catch(() => {
      state.yolo.latest = null;
    })
    .finally(() => {
      state.yolo.inFlight = false;
    });
}

async function runYoloFrame() {
  const frame = createYoloInput();
  if (!frame) return;

  const inputName = state.yolo.session.inputNames[0];
  const output = await state.yolo.session.run({ [inputName]: frame.tensor });
  const outputName = state.yolo.session.outputNames[0];
  const detections = parseYoloOutput(output[outputName], frame.meta);
  const target = selectTrackedVehicle(detections);
  renderYoloDetections(detections, target);
  updateYoloMotion(target, detections.length);
}

function createYoloInput() {
  const videoWidth = els.video.videoWidth;
  const videoHeight = els.video.videoHeight;
  if (!videoWidth || !videoHeight || !window.ort) return null;

  const size = YOLO_CONFIG.inputSize;
  const canvas = state.yolo.inputCanvas || document.createElement("canvas");
  state.yolo.inputCanvas = canvas;
  if (canvas.width !== size || canvas.height !== size) {
    canvas.width = size;
    canvas.height = size;
  }

  const ctx = state.yolo.inputCtx || canvas.getContext("2d", { willReadFrequently: true });
  state.yolo.inputCtx = ctx;
  const scale = Math.min(size / videoWidth, size / videoHeight);
  const drawWidth = Math.round(videoWidth * scale);
  const drawHeight = Math.round(videoHeight * scale);
  const padX = Math.floor((size - drawWidth) / 2);
  const padY = Math.floor((size - drawHeight) / 2);

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(els.video, 0, 0, videoWidth, videoHeight, padX, padY, drawWidth, drawHeight);

  const pixels = ctx.getImageData(0, 0, size, size).data;
  const inputLength = 3 * size * size;
  const input =
    state.yolo.inputData && state.yolo.inputData.length === inputLength
      ? state.yolo.inputData
      : new Float32Array(inputLength);
  state.yolo.inputData = input;
  const plane = size * size;

  for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
    input[p] = pixels[i] / 255;
    input[plane + p] = pixels[i + 1] / 255;
    input[plane * 2 + p] = pixels[i + 2] / 255;
  }

  return {
    tensor: new window.ort.Tensor("float32", input, [1, 3, size, size]),
    meta: { scale, padX, padY, videoWidth, videoHeight },
  };
}

function parseYoloOutput(output, meta) {
  if (!output || !output.data || output.dims.length < 3) return [];

  const [, dimA, dimB] = output.dims;
  const attributes = dimA < dimB ? dimA : dimB;
  const anchors = dimA < dimB ? dimB : dimA;
  const channelsFirst = dimA < dimB;
  const hasObjectness = attributes === 85;
  const classOffset = hasObjectness ? 5 : 4;
  const detections = [];

  const read = (anchor, attr) =>
    channelsFirst ? output.data[attr * anchors + anchor] : output.data[anchor * attributes + attr];

  for (let anchor = 0; anchor < anchors; anchor += 1) {
    let bestClassId = -1;
    let bestClassScore = 0;
    const objectness = hasObjectness ? read(anchor, 4) : 1;

    for (let attr = classOffset; attr < attributes; attr += 1) {
      const classId = attr - classOffset;
      if (!YOLO_CONFIG.vehicleClassIds.has(classId)) continue;
      const score = read(anchor, attr);
      if (score > bestClassScore) {
        bestClassScore = score;
        bestClassId = classId;
      }
    }

    const confidence = bestClassScore * objectness;
    if (confidence < YOLO_CONFIG.minConfidence || bestClassId < 0) continue;

    const cx = read(anchor, 0);
    const cy = read(anchor, 1);
    const width = read(anchor, 2);
    const height = read(anchor, 3);
    const box = yoloBoxToVideoBox(cx, cy, width, height, meta);
    if (!box) continue;

    detections.push({ ...box, confidence, classId: bestClassId, id: detections.length });
  }

  return detections;
}

function yoloBoxToVideoBox(cx, cy, width, height, meta) {
  const x1 = (cx - width / 2 - meta.padX) / meta.scale;
  const y1 = (cy - height / 2 - meta.padY) / meta.scale;
  const x2 = (cx + width / 2 - meta.padX) / meta.scale;
  const y2 = (cy + height / 2 - meta.padY) / meta.scale;
  const left = clamp(x1 / meta.videoWidth, 0, 1);
  const top = clamp(y1 / meta.videoHeight, 0, 1);
  const right = clamp(x2 / meta.videoWidth, 0, 1);
  const bottom = clamp(y2 / meta.videoHeight, 0, 1);
  const boxWidth = right - left;
  const boxHeight = bottom - top;

  if (boxWidth <= 0.01 || boxHeight <= 0.01) return null;

  return {
    x: left,
    y: top,
    w: boxWidth,
    h: boxHeight,
    cx: left + boxWidth / 2,
    cy: top + boxHeight / 2,
    area: boxWidth * boxHeight,
  };
}

function selectBestVehicle(detections) {
  let best = null;
  let bestScore = 0;

  detections.forEach((detection) => {
    if (detection.area < 0.0025) return;

    const sideOffset = Math.abs(detection.cx - 0.5);
    const centerBias = 1 - Math.min(1, sideOffset / 0.5);
    const lowerBias = clamp((detection.cy - 0.16) / 0.84, 0, 1);
    const areaScore = Math.min(46, detection.area * 360);
    const sidePenalty = sideOffset > 0.38 ? 42 : sideOffset > 0.3 ? 20 : 0;
    const smallSidePenalty = detection.area < 0.02 && sideOffset > 0.26 ? 18 : 0;
    const score =
      detection.confidence * 70 + centerBias * 34 + lowerBias * 30 + areaScore - sidePenalty - smallSidePenalty;
    if (score > bestScore) {
      bestScore = score;
      best = { ...detection, trackedScore: score };
    }
  });

  return best;
}

function selectTrackedVehicle(detections) {
  const previous = state.yolo.previousTarget;
  const locked = state.armed || Boolean(state.stoppedSince) || state.yolo.stillMs >= 900 || state.yolo.locked;
  const anchor = locked && state.yolo.lockedReference ? state.yolo.lockedReference : previous;
  if (!anchor) return selectBestVehicle(detections);

  let bestMatch = null;
  let bestMatchScore = 0;

  detections.forEach((detection) => {
    const dx = detection.cx - anchor.cx;
    const dy = detection.cy - anchor.cy;
    const centerDistance = Math.sqrt(dx * dx + dy * dy);
    const overlap = boxIou(detection, anchor);
    const areaRatio = Math.min(detection.area, anchor.area) / Math.max(detection.area, anchor.area, 0.001);
    const maxDistance = locked ? 0.12 : 0.16;
    const distanceScore = Math.max(0, 1 - centerDistance / maxDistance);
    const jumpPenalty = locked && centerDistance > 0.12 && overlap < 0.1 ? 48 : 0;
    const matchScore = overlap * 118 + distanceScore * 54 + areaRatio * 24 - jumpPenalty;

    if (matchScore > bestMatchScore) {
      bestMatchScore = matchScore;
      bestMatch = detection;
    }
  });

  if (bestMatch && bestMatchScore >= (locked ? 58 : 46)) {
    return { ...bestMatch, trackedScore: bestMatchScore };
  }

  if (locked || state.yolo.missingFrames < 2) {
    return null;
  }

  return selectBestVehicle(detections);
}

function renderYoloDetections(detections = [], target = null) {
  state.yolo.detections = detections;
  state.yolo.target = target;
  if (!els.yoloOverlay) return;

  els.yoloOverlay.replaceChildren();
  if (!detections.length || !els.video.videoWidth || !els.video.videoHeight) return;

  const videoRect = getRenderedVideoRect();
  detections
    .slice()
    .sort((a, b) => b.area - a.area)
    .slice(0, 8)
    .forEach((detection) => {
      const tracked = target && detection.id === target.id;
      const box = document.createElement("div");
      const label = document.createElement("span");
      const left = videoRect.x + detection.x * videoRect.w;
      const top = videoRect.y + detection.y * videoRect.h;
      const width = detection.w * videoRect.w;
      const height = detection.h * videoRect.h;

      box.className = tracked ? "yolo-box tracked" : "yolo-box";
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
      label.textContent = `${vehicleLabel(detection.classId)} ${Math.round(detection.confidence * 100)}%`;
      box.appendChild(label);
      els.yoloOverlay.appendChild(box);
    });
}

function getRenderedVideoRect() {
  const stageRect = els.stage.getBoundingClientRect();
  const videoWidth = els.video.videoWidth || stageRect.width;
  const videoHeight = els.video.videoHeight || stageRect.height;
  const scale = Math.max(stageRect.width / videoWidth, stageRect.height / videoHeight);
  const width = videoWidth * scale;
  const height = videoHeight * scale;

  return {
    x: (stageRect.width - width) / 2,
    y: (stageRect.height - height) / 2,
    w: width,
    h: height,
  };
}

function vehicleLabel(classId) {
  const labels = {
    1: "自行車",
    2: "汽車",
    3: "機車",
    5: "公車",
    7: "卡車",
  };
  return labels[classId] || "車輛";
}

function updateYoloMotion(target, detectionCount) {
  const previous = state.yolo.previousTarget;
  const reference = state.yolo.lockedReference;
  const now = performance.now();

  if (!target) {
    if (previous) {
      state.yolo.missingFrames += 1;
    }

    const moved = Boolean(previous && state.yolo.missingFrames >= (state.yolo.locked ? 1 : 2));
    const rawMotion = moved ? Math.min(98, (state.yolo.locked ? 72 : 56) + state.yolo.missingFrames * 14) : 0;
    state.yolo.smoothMotion = state.yolo.smoothMotion * 0.55 + rawMotion * 0.45;
    state.yolo.stableSince = 0;
    state.yolo.stillMs = 0;
    state.yolo.latest = {
      hasTarget: false,
      moved,
      motion: Math.round(state.yolo.smoothMotion),
      stable: false,
      stillMs: 0,
      confidence: 0,
      detectionCount,
      updatedAt: now,
    };
    return;
  }

  state.yolo.missingFrames = 0;
  let rawMotion = 0;
  let moved = false;
  let normalizedShift = 0;
  let areaChange = 0;
  let overlapChange = 0;
  let referenceShift = 0;
  let referenceAreaChange = 0;
  let referenceOverlapChange = 0;

  if (previous) {
    const dx = target.cx - previous.cx;
    const dy = target.cy - previous.cy;
    const centerShift = Math.sqrt(dx * dx + dy * dy);
    const roiDiagonal = Math.sqrt(1 + 1);
    normalizedShift = centerShift / Math.max(roiDiagonal, 0.1);
    areaChange = Math.abs(target.area - previous.area) / Math.max(previous.area, 0.01);
    overlapChange = 1 - boxIou(target, previous);

    const frameRawMotion = Math.min(
      100,
      Math.round(normalizedShift * 460 + areaChange * 72 + overlapChange * 28),
    );
    const lockedOrArmed = state.yolo.locked || state.armed;
    rawMotion = frameRawMotion;

    if (lockedOrArmed && reference) {
      const refDx = target.cx - reference.cx;
      const refDy = target.cy - reference.cy;
      referenceShift = Math.sqrt(refDx * refDx + refDy * refDy) / Math.sqrt(2);
      referenceAreaChange = Math.abs(target.area - reference.area) / Math.max(reference.area, 0.01);
      referenceOverlapChange = 1 - boxIou(target, reference);
      const referenceRawMotion = Math.min(
        100,
        Math.round(referenceShift * 520 + referenceAreaChange * 96 + referenceOverlapChange * 18),
      );
      rawMotion = Math.max(frameRawMotion, referenceRawMotion);
    }

    const motionThreshold = lockedOrArmed ? 24 : 30;
    const shiftThreshold = lockedOrArmed ? 0.048 : 0.08;
    const areaThreshold = lockedOrArmed ? 0.12 : 0.22;
    const referenceIdentity =
      !reference ||
      (target.classId === reference.classId &&
        (boxIou(target, reference) >= 0.16 ||
          referenceShift <= 0.13 ||
          referenceOverlapChange <= 0.62));
    const referenceMoved =
      lockedOrArmed &&
      reference &&
      referenceIdentity &&
      (referenceShift >= shiftThreshold ||
        referenceAreaChange >= areaThreshold ||
        referenceOverlapChange >= 0.36);
    moved =
      lockedOrArmed && reference
        ? referenceMoved ||
          (referenceIdentity &&
            (rawMotion >= motionThreshold + 8 ||
              referenceShift >= shiftThreshold * 1.15 ||
              referenceAreaChange >= areaThreshold * 1.12))
        : rawMotion >= motionThreshold ||
          normalizedShift >= 0.08 ||
          areaChange >= 0.22;
  }

  const smoothing = state.yolo.locked || state.armed ? 0.72 : 0.55;
  state.yolo.smoothMotion = state.yolo.smoothMotion * (1 - smoothing) + rawMotion * smoothing;
  const stable =
    !moved &&
    state.yolo.smoothMotion <= 18 &&
    normalizedShift <= 0.018 &&
    areaChange <= 0.08 &&
    overlapChange <= 0.28;

  if (stable) {
    if (!state.yolo.stableSince) state.yolo.stableSince = now;
    state.yolo.stillMs = now - state.yolo.stableSince;
    if (state.yolo.stillMs >= 900 || state.armed || state.stoppedSince) {
      state.yolo.locked = true;
      if (!state.yolo.lockedReference || state.yolo.stillMs < 1300) {
        state.yolo.lockedReference = target;
      }
    }
  } else {
    if (!state.armed && !state.stoppedSince) {
      state.yolo.locked = false;
      state.yolo.lockedReference = null;
    }
    state.yolo.stableSince = 0;
    state.yolo.stillMs = 0;
  }

  state.yolo.latest = {
    hasTarget: true,
    moved,
    motion: Math.round(state.yolo.smoothMotion),
    rawMotion: Math.round(rawMotion),
    referenceShift: Math.round(referenceShift * 1000) / 1000,
    referenceAreaChange: Math.round(referenceAreaChange * 1000) / 1000,
    referenceOverlapChange: Math.round(referenceOverlapChange * 1000) / 1000,
    stable,
    stillMs: Math.round(state.yolo.stillMs),
    confidence: Math.round(target.confidence * 100),
    classId: target.classId,
    detectionCount,
    updatedAt: now,
  };
  state.yolo.previousTarget = target;
}

function mergeYoloMetrics(metrics) {
  const latest = state.yolo.latest;
  if (!latest || performance.now() - latest.updatedAt > YOLO_CONFIG.intervalMs * 4) return metrics;
  return { ...metrics, yolo: latest };
}

function deriveMotionState(metrics, sensitivity, tolerance) {
  const hasBaseline = state.baseline.samples >= 4;
  const baselineMotion = hasBaseline ? state.baseline.motion : 0;
  const baselineGlobal = hasBaseline ? state.baseline.global : 0;
  const baselineLower = hasBaseline ? state.baseline.lower : 0;
  const engineMotion = Math.max(metrics.globalMotion, baselineGlobal, baselineMotion * 0.9);
  const relativeMotion = Math.max(0, metrics.motion - engineMotion);
  const mismatch = Math.abs(metrics.motion - metrics.globalMotion);
  const lowerMotion = metrics.lowerMotion || 0;
  const moveThreshold = Math.max(12, 58 - sensitivity * 0.46);
  const globalStopLimit = hasBaseline
    ? Math.min(58, Math.max(28, baselineGlobal + tolerance * 0.75))
    : Math.min(46, tolerance + 24);
  const lowerStopLimit = hasBaseline
    ? Math.min(58, Math.max(28, baselineLower + tolerance * 0.75))
    : Math.min(46, tolerance + 24);
  const ownCarLooksStopped =
    metrics.globalMotion <= globalStopLimit &&
    lowerMotion <= lowerStopLimit;
  const hasFreshYolo = Boolean(metrics.yolo && performance.now() - metrics.yolo.updatedAt <= YOLO_CONFIG.intervalMs * 4);
  const yoloHasTrackedTarget = Boolean(metrics.yolo?.hasTarget);
  const yoloLooksStopped =
    hasFreshYolo &&
    yoloHasTrackedTarget &&
    Boolean(metrics.yolo?.stable) &&
    metrics.yolo.stillMs >= 1200 &&
    metrics.yolo.motion <= Math.max(18, tolerance + 8);
  const yoloRequiresStableStop = state.yolo.ready && hasFreshYolo && yoloHasTrackedTarget;
  const stoppedByBaseline =
    hasBaseline &&
    ownCarLooksStopped &&
    metrics.motion <= baselineMotion + tolerance * 1.05 &&
    (!yoloRequiresStableStop || yoloLooksStopped);
  const stoppedBySharedShake =
    ownCarLooksStopped &&
    mismatch <= tolerance * 1.05 &&
    (!yoloRequiresStableStop || yoloLooksStopped);
  const stoppedByYolo =
    ownCarLooksStopped &&
    yoloLooksStopped;
  const isStopped = stoppedByBaseline || stoppedBySharedShake || stoppedByYolo;
  const pixelFrontMotion = Math.min(100, Math.round(relativeMotion * 1.45));
  const yoloMotion = metrics.yolo ? metrics.yolo.motion : 0;
  const fastTargetMoved = Boolean(metrics.fastTarget?.moved && (state.yolo.locked || state.armed || state.stoppedSince));
  const fastTargetMotion = metrics.fastTarget ? metrics.fastTarget.motion : 0;
  const frontMotion = Math.max(pixelFrontMotion, yoloMotion, fastTargetMotion);
  const yoloMoveThreshold = state.yolo.locked || state.armed ? 18 : Math.max(28, moveThreshold * 0.68);
  const yoloMissingWithTargetMotion = Boolean(
    metrics.yolo?.moved &&
      !yoloHasTrackedTarget &&
      fastTargetMotion >= 18 &&
      metrics.fastTarget?.activeCells >= 6,
  );
  const yoloTrackedWithTargetMotion = Boolean(
    yoloHasTrackedTarget &&
      fastTargetMotion >= 16 &&
      metrics.fastTarget?.activeCells >= 6,
  );
  const yoloStrongReferenceMove = Boolean(
    yoloHasTrackedTarget &&
      (metrics.yolo?.referenceShift >= 0.045 ||
        metrics.yolo?.referenceAreaChange >= 0.13 ||
        metrics.yolo?.referenceOverlapChange >= 0.34 ||
        metrics.yolo?.rawMotion >= 34),
  );
  const yoloMoved = Boolean(
    metrics.yolo?.moved &&
      (state.armed
        ? yoloStrongReferenceMove || yoloTrackedWithTargetMotion || yoloMissingWithTargetMotion
        : yoloHasTrackedTarget) &&
      (yoloMotion >= yoloMoveThreshold || (state.yolo.locked && metrics.yolo.rawMotion >= 24)),
  );
  const allowPixelFallback = !state.yolo.ready || (!state.armed && !state.yolo.locked);
  const pixelMoved =
    allowPixelFallback &&
    pixelFrontMotion > moveThreshold &&
    relativeMotion > tolerance * 0.85;
  const stability = stoppedByYolo
    ? Math.max(72, Math.min(100, 100 - yoloMotion))
    : isStopped
      ? Math.max(0, 100 - Math.round(Math.max(mismatch, relativeMotion, lowerMotion * 0.45)))
      : metrics.stability;

  return {
    stability,
    frontMotion,
    frontCarMoved: state.armed && (fastTargetMoved || yoloMoved || pixelMoved),
    isStopped,
  };
}

function learnVibrationBaseline(metrics, tolerance) {
  const sharedShake = Math.abs(metrics.motion - metrics.globalMotion) <= tolerance * 1.15 + 4;
  const reasonableShake =
    metrics.motion <= tolerance + 34 &&
    metrics.globalMotion <= tolerance + 34 &&
    (metrics.lowerMotion || 0) <= tolerance + 34;
  if (!sharedShake || !reasonableShake) return;

  const alpha = state.baseline.samples < 8 ? 0.35 : 0.08;
  if (!state.baseline.samples) {
    state.baseline.motion = metrics.motion;
    state.baseline.global = metrics.globalMotion;
    state.baseline.lower = metrics.lowerMotion || metrics.globalMotion;
  } else {
    state.baseline.motion = state.baseline.motion * (1 - alpha) + metrics.motion * alpha;
    state.baseline.global = state.baseline.global * (1 - alpha) + metrics.globalMotion * alpha;
    state.baseline.lower = state.baseline.lower * (1 - alpha) + (metrics.lowerMotion || metrics.globalMotion) * alpha;
  }
  state.baseline.samples += 1;
}

function resetMotionState() {
  state.previousGray = null;
  state.stoppedSince = 0;
  state.armed = false;
  state.armedAt = 0;
  state.demoStart = 0;
  state.alertHoldUntil = 0;
  state.smoothed.motion = 0;
  state.smoothed.global = 0;
  state.smoothed.lower = 0;
  state.baseline.motion = 0;
  state.baseline.global = 0;
  state.baseline.lower = 0;
  state.baseline.samples = 0;
  resetBrakeLightState();
  resetFastTargetState();
  resetYoloTracking();
  updateStopSeconds(0);
}

function resetBrakeLightState() {
  state.brake.baseline = 0;
  state.brake.samples = 0;
  state.brake.lastScore = 0;
  state.brake.offSince = 0;
  state.brake.off = false;
  state.brake.updatedAt = 0;
}

function resetFastTargetState() {
  state.fastTarget.baseline = 0;
  state.fastTarget.samples = 0;
  state.fastTarget.overSince = 0;
  state.fastTarget.overKind = "";
  state.fastTarget.moved = false;
  state.fastTarget.motion = 0;
  state.fastTarget.updatedAt = 0;
}

function resetYoloTracking() {
  state.yolo.latest = null;
  state.yolo.detections = [];
  state.yolo.target = null;
  state.yolo.previousTarget = null;
  state.yolo.missingFrames = 0;
  state.yolo.smoothMotion = 0;
  state.yolo.stableSince = 0;
  state.yolo.stillMs = 0;
  state.yolo.locked = false;
  state.yolo.lockedReference = null;
  renderYoloDetections([]);
}

function boxIou(a, b) {
  const intersection = intersectArea(a, b);
  const union = a.w * a.h + b.w * b.h - intersection;
  return union > 0 ? intersection / union : 0;
}

function intersectArea(a, b) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function scoreAveragePixels(pixels) {
  let red = 0;
  let green = 0;
  let useful = 0;

  for (let i = 0; i < pixels.length; i += 16) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    if (max < 58 || delta < 28) continue;

    useful += 1;
    const sat = delta / max;
    const val = max / 255;
    const hue = rgbToHue(r, g, b, max, delta);
    const weight = sat * val * 100;

    if (hue <= 22 || hue >= 338) {
      red += weight;
    } else if (hue >= 78 && hue <= 178) {
      green += weight;
    }
  }

  if (!useful) return { red: 0, green: 0 };

  return {
    red: Math.min(100, Math.round(red / useful)),
    green: Math.min(100, Math.round(green / useful)),
  };
}

function scoreSmallSignalPixels(pixels, width, height) {
  const cellsX = 12;
  const cellsY = 12;
  const redCells = new Float32Array(cellsX * cellsY);
  const greenCells = new Float32Array(cellsX * cellsY);
  const redCounts = new Uint16Array(cellsX * cellsY);
  const greenCounts = new Uint16Array(cellsX * cellsY);
  let redTotal = 0;
  let greenTotal = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;

      if (max < 42 || delta < 18) continue;

      const sat = delta / max;
      const val = max / 255;
      if (sat < 0.28 || val < 0.18) continue;

      const hue = rgbToHue(r, g, b, max, delta);
      const weight = Math.pow(sat, 1.25) * Math.pow(val, 1.1) * 100;
      const cx = Math.min(cellsX - 1, Math.floor((x / width) * cellsX));
      const cy = Math.min(cellsY - 1, Math.floor((y / height) * cellsY));
      const cell = cy * cellsX + cx;

      if (hue <= 28 || hue >= 334) {
        redCells[cell] += weight;
        redCounts[cell] += 1;
        redTotal += 1;
      } else if (hue >= 68 && hue <= 188) {
        greenCells[cell] += weight;
        greenCounts[cell] += 1;
        greenTotal += 1;
      }
    }
  }

  return {
    red: scoreColorCells(redCells, redCounts, redTotal),
    green: scoreColorCells(greenCells, greenCounts, greenTotal),
  };
}

function scoreColorCells(cells, counts, totalCount) {
  if (!totalCount) return 0;

  const scores = [];
  for (let i = 0; i < cells.length; i += 1) {
    if (!counts[i]) continue;
    const average = cells[i] / counts[i];
    const clusterBonus = Math.min(18, Math.sqrt(counts[i]) * 4);
    scores.push(Math.min(100, average + clusterBonus));
  }

  scores.sort((a, b) => b - a);
  const top = scores.slice(0, 4);
  const topAverage = top.reduce((sum, value) => sum + value, 0) / top.length;
  const confidence = Math.min(1, totalCount / 10);
  const presenceBonus = Math.min(16, Math.sqrt(totalCount) * 3);

  return Math.min(100, Math.round(topAverage * (0.44 + confidence * 0.42) + presenceBonus));
}

function rgbToHue(r, g, b, max, delta) {
  if (delta === 0) return 0;
  let hue;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return (hue * 60 + 360) % 360;
}

function triggerAlert(label, options = {}) {
  if (label === "前車移動了" && !state.armed) return;

  const now = Date.now();
  if (now - state.lastAlertAt < 2600 && label !== "測試提醒") return;
  state.lastAlertAt = now;

  setMessage(`${label}。請確認路況後再起步。`);
  els.flash.classList.remove("active");
  void els.flash.offsetWidth;
  els.flash.classList.add("active");

  if (els.soundToggle.checked) {
    playTone(options);
  }
  if (els.vibrateToggle.checked) {
    if ("vibrate" in navigator) {
      navigator.vibrate([160, 70, 160, 70, 260]);
    } else {
      setMessage(`${label}。此 iPhone 瀏覽器不支援網頁震動，請使用聲音提醒。`);
    }
  }
  if (els.notifyToggle.checked && Notification.permission === "granted") {
    new Notification("綠燈提醒", { body: "可能已轉綠燈，請確認路況。" });
  }
}

async function unlockAudio() {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  prepareMediaTone();

  if (!AudioCtor && !state.mediaTone) {
    els.soundToggle.checked = false;
    els.soundToggle.disabled = true;
    return false;
  }

  if (AudioCtor && !state.audio) {
    state.audio = new AudioCtor();
  }

  try {
    if (state.audio && state.audio.state === "suspended") {
      await state.audio.resume();
    }
    primeAudioContext();
    state.audioUnlocked = true;
    return true;
  } catch {
    state.audioUnlocked = Boolean(state.mediaTone);
    return state.audioUnlocked;
  }
}

function playTone(options = {}) {
  const playedMedia = playMediaTone(options.userGesture);

  if (!state.audio || !state.audioUnlocked) {
    if (!playedMedia) {
      setMessage("音效尚未被 iPhone 啟用。請把音量調高，關閉靜音鍵，再按「測試提醒」。");
    }
    return;
  }

  const audio = state.audio;
  const now = audio.currentTime;
  [0, 0.18, 0.36].forEach((offset, index) => {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = index === 1 ? 1046 : 880;
    gain.gain.setValueAtTime(0.001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.45, now + offset + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.14);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(now + offset);
    oscillator.stop(now + offset + 0.16);
  });
}

function prepareMediaTone() {
  if (state.mediaTone) return;

  state.mediaTone = new Audio(buildBeepDataUrl());
  state.mediaTone.preload = "auto";
  state.mediaTone.playsInline = true;
  state.mediaTone.volume = 1;
}

function playMediaTone(userGesture = false) {
  if (!state.mediaTone) return false;

  try {
    state.mediaTone.pause();
    state.mediaTone.currentTime = 0;
    const playPromise = state.mediaTone.play();
    if (playPromise) {
      playPromise
        .then(() => {
          state.audioUnlocked = true;
        })
        .catch(() => {
          if (userGesture) {
            setMessage("iPhone 沒有播放音效。請確認音量、靜音鍵，並從主畫面 PWA 重新開啟後再測試。");
          }
        });
    }
    return true;
  } catch {
    return false;
  }
}

function primeAudioContext() {
  if (!state.audio) return;

  const audio = state.audio;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, audio.currentTime);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(audio.currentTime);
  oscillator.stop(audio.currentTime + 0.035);
}

function buildBeepDataUrl() {
  const sampleRate = 22050;
  const seconds = 0.72;
  const samples = Math.floor(sampleRate * seconds);
  const dataBytes = samples * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples; i += 1) {
    const t = i / sampleRate;
    const phase = t % 0.24;
    const toneIndex = Math.floor(t / 0.24);
    const frequency = toneIndex === 1 ? 1175 : 932;
    const active = phase < 0.16;
    const envelope = active ? Math.min(1, phase / 0.015) * Math.min(1, (0.16 - phase) / 0.025) : 0;
    const value = Math.sin(2 * Math.PI * frequency * t) * envelope * 0.86;
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, value)) * 32767, true);
  }

  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }

  return `data:audio/wav;base64,${btoa(binary)}`;
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

function detectFeedbackSupport() {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor && !window.HTMLAudioElement) {
    els.soundToggle.checked = false;
    els.soundToggle.disabled = true;
    els.soundToggle.closest(".switch").classList.add("disabled");
  }

  if (!("vibrate" in navigator)) {
    els.vibrateToggle.checked = false;
    els.vibrateToggle.disabled = true;
    const label = els.vibrateToggle.closest(".switch");
    label.classList.add("disabled");
    label.querySelector("span").textContent = "震動不可用";
  }
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;

  try {
    state.wakeLock = await navigator.wakeLock.request("screen");
  } catch {
    setMessage("已開始偵測。若螢幕自動鎖定，請暫時調整 iPhone 自動鎖定時間。");
  }
}

function releaseWakeLock() {
  if (state.wakeLock) {
    state.wakeLock.release();
  }
  state.wakeLock = null;
}

async function requestNotificationPermission() {
  if (!els.notifyToggle.checked) return;

  if (!("Notification" in window)) {
    els.notifyToggle.checked = false;
    setMessage("此瀏覽器不支援網頁通知。");
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    els.notifyToggle.checked = false;
    setMessage("通知未開啟，仍會使用聲音與畫面提醒。");
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function updateMeters(red, green) {
  els.redMeter.value = red;
  els.greenMeter.value = green;
  els.redValue.textContent = red;
  els.greenValue.textContent = green;
}

function updateStopSeconds(seconds) {
  const rounded = Math.max(0, Math.floor(seconds));
  state.stoppedSeconds = rounded;
  const target = Math.max(1, Number(els.holdFrames.value));
  els.stopMeter.max = String(Math.max(target, rounded));
  els.stopMeter.value = String(Math.min(rounded, Number(els.stopMeter.max)));
  els.stopValue.textContent = `${rounded}秒`;
}

function setStatus(status) {
  els.stateBadge.textContent = statusText[status] || statusText.idle;
  els.stateBadge.className = `state-badge ${status}`;
}

function setMessage(text) {
  els.message.textContent = text;
}

function publishDebugFrame(now, metrics, derived) {
  if (!DEBUG_ENABLED) return;

  const frame = {
    now: Math.round(now),
    videoTime: Math.round((els.video.currentTime || 0) * 1000) / 1000,
    running: state.running,
    armed: state.armed,
    armedAt: Math.round(state.armedAt || 0),
    stoppedSince: Math.round(state.stoppedSince || 0),
    stoppedSeconds: state.stoppedSeconds,
    status: els.stateBadge.textContent,
    message: els.message.textContent,
    metrics: {
      motion: metrics.motion,
      globalMotion: metrics.globalMotion,
      lowerMotion: metrics.lowerMotion,
      yolo: metrics.yolo || null,
      brake: metrics.brake || null,
      fastTarget: metrics.fastTarget || null,
    },
    derived,
  };

  window.__frontCarDebug = frame;
  if (!window.__frontCarDebugLog) window.__frontCarDebugLog = [];
  window.__frontCarDebugLog.push(frame);
  if (window.__frontCarDebugLog.length > 900) {
    window.__frontCarDebugLog.splice(0, window.__frontCarDebugLog.length - 900);
  }

  const eventKey = `${frame.status}|${frame.stoppedSeconds}|${frame.message}|${derived.frontCarMoved}`;
  if (eventKey !== state.debug.lastKey) {
    state.debug.events.push({
      videoTime: frame.videoTime,
      status: frame.status,
      stoppedSeconds: frame.stoppedSeconds,
      message: frame.message,
      frontMotion: derived.frontMotion,
      frontCarMoved: derived.frontCarMoved,
      isStopped: derived.isStopped,
      yolo: metrics.yolo || null,
      fastTarget: metrics.fastTarget || null,
      brake: metrics.brake || null,
    });
    if (state.debug.events.length > 120) {
      state.debug.events.splice(0, state.debug.events.length - 120);
    }
    state.debug.lastKey = eventKey;
  }

  writeDebugState({ last: frame, events: state.debug.events });
}

function writeDebugState(payload) {
  if (!DEBUG_ENABLED) return;

  let element = document.getElementById("debugState");
  if (!element) {
    element = document.createElement("script");
    element.id = "debugState";
    element.type = "application/json";
    document.body.appendChild(element);
  }
  element.textContent = payload ? JSON.stringify(payload) : "";
}

function isCameraSecureContext() {
  return (
    window.isSecureContext ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  );
}

function warnIfCameraBlockedByHttp() {
  if (!isCameraSecureContext()) {
    setMessage("目前不是 HTTPS，相機會被瀏覽器封鎖。請改用 https://9677.fun。");
  }
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (state.reloadingForUpdate) return;
      state.reloadingForUpdate = true;
      setMessage("新版已載入，正在重新整理。");
      window.location.reload();
    });

    navigator.serviceWorker
      .register(`./sw.js?v=${APP_VERSION}`)
      .then((registration) => {
        if (registration.waiting) {
          activateUpdatedWorker(registration.waiting);
        }

        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (!worker) return;

          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              activateUpdatedWorker(worker);
            }
          });
        });

        if (navigator.onLine) {
          registration.update();
        }
      })
      .catch(() => {
        setMessage("離線快取尚未啟用，但偵測功能仍可使用。");
      });
  }
}

function activateUpdatedWorker(worker) {
  setMessage("偵測到新版，正在更新。");
  worker.postMessage({ type: "SKIP_WAITING" });
}
