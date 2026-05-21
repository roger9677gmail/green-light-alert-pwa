const $ = (id) => document.getElementById(id);

const APP_VERSION = "2.0.0";

const els = {
  video: $("camera"),
  canvas: $("analysisCanvas"),
  roiBox: $("roiBox"),
  flash: $("flash"),
  demoLight: $("demoLight"),
  stateBadge: $("stateBadge"),
  versionLabel: $("versionLabel"),
  startBtn: $("startBtn"),
  testBtn: $("testBtn"),
  redMeter: $("redMeter"),
  greenMeter: $("greenMeter"),
  redValue: $("redValue"),
  greenValue: $("greenValue"),
  message: $("message"),
  sensitivity: $("sensitivity"),
  holdFrames: $("holdFrames"),
  roiX: $("roiX"),
  roiY: $("roiY"),
  roiW: $("roiW"),
  roiH: $("roiH"),
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
  stoppedSince: 0,
  armed: false,
  demoStart: 0,
  alertHoldUntil: 0,
  lastAlertAt: 0,
  roi: { x: 0.22, y: 0.16, w: 0.56, h: 0.34 },
  smoothed: { motion: 0, global: 0 },
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
  registerServiceWorker();
  detectFeedbackSupport();
  bindControls();
  updateRoiFromControls();
  setStatus("idle");
}

function bindControls() {
  els.startBtn.addEventListener("click", toggleDetection);
  els.testBtn.addEventListener("click", async () => {
    await unlockAudio();
    triggerAlert("測試提醒", { userGesture: true });
  });
  els.notifyToggle.addEventListener("change", requestNotificationPermission);
  els.demoToggle.addEventListener("change", () => {
    stopCameraStream();
    resetMotionState();
    setMessage(els.demoToggle.checked ? "模擬模式已開啟，前車會先停止再移動。" : "請固定手機，讓框線包住前車。");
    updateDemoVisual(performance.now());
  });
  els.autoToggle.addEventListener("change", () => {
    resetMotionState();
    setMessage(els.autoToggle.checked ? "自動模式會在停止超過設定秒數後進入待提醒。" : "自動已關閉，會直接監看前車移動。");
  });

  [els.roiX, els.roiY, els.roiW, els.roiH].forEach((input) => {
    input.addEventListener("input", updateRoiFromControls);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.running) {
      requestWakeLock();
    }
  });
}

async function toggleDetection() {
  if (state.running) {
    stopDetection();
    return;
  }

  state.running = true;
  resetMotionState();
  state.lastAlertAt = 0;
  els.startBtn.textContent = "停止監看";
  const audioReady = await unlockAudio();

  if (!els.demoToggle.checked) {
    try {
      await startCamera();
    } catch (error) {
      state.running = false;
      els.startBtn.textContent = "開始監看";
      setStatus("idle");
      setMessage(`相機無法啟動：${error.message || "請確認權限與 HTTPS"}`);
      return;
    }
  }

  await requestWakeLock();
  setStatus(els.demoToggle.checked ? "demo" : "watching");
  if (els.soundToggle.checked && !audioReady) {
    setMessage("音效無法啟用。請確認 iPhone 音量、靜音鍵，或再按一次「測試提醒」。");
  }
  analyzeFrame();
}

async function startCamera() {
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
  setMessage("相機已啟動。框線對準前車，停穩 5 秒後會自動待提醒。");
}

function stopDetection() {
  state.running = false;
  cancelAnimationFrame(state.rafId);
  stopCameraStream();
  releaseWakeLock();
  els.startBtn.textContent = "開始監看";
  resetMotionState();
  updateMeters(0, 0);
  setStatus("idle");
  setMessage("監看已停止。");
}

function stopCameraStream() {
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
  }
  state.stream = null;
  els.video.srcObject = null;
}

function analyzeFrame(now = performance.now()) {
  if (!state.running) return;

  const metrics = els.demoToggle.checked ? analyzeDemo(now) : analyzeCamera();
  updateMeters(metrics.stability, metrics.motion);

  if (now < state.alertHoldUntil) {
    setStatus("moving");
    state.rafId = requestAnimationFrame(analyzeFrame);
    return;
  }

  const sensitivity = Number(els.sensitivity.value);
  const stopSeconds = Number(els.holdFrames.value);
  const moveThreshold = Math.max(10, 52 - sensitivity * 0.45);
  const stopThreshold = Math.max(5, 26 - sensitivity * 0.22);
  const isStopped = metrics.motion < stopThreshold && metrics.globalMotion < stopThreshold;
  const frontCarMoved = metrics.motion > moveThreshold && metrics.globalMotion < moveThreshold * 0.85;

  if (!els.autoToggle.checked) {
    state.armed = true;
  }

  if (!state.armed) {
    if (isStopped) {
      if (!state.stoppedSince) state.stoppedSince = now;
      const stoppedMs = now - state.stoppedSince;
      setStatus(stoppedMs >= stopSeconds * 1000 ? "armed" : "stable");
      setMessage(`停止穩定 ${Math.min(stopSeconds, Math.floor(stoppedMs / 1000))}/${stopSeconds} 秒。`);
      if (stoppedMs >= stopSeconds * 1000) {
        state.armed = true;
        setStatus("armed");
        setMessage("已待提醒。前車移動時會發出提示。");
      }
    } else {
      state.stoppedSince = 0;
      setStatus(els.demoToggle.checked ? "demo" : "watching");
      setMessage("監看中。車身或前車尚未穩定停止。");
    }
  } else if (frontCarMoved) {
    setStatus("moving");
    triggerAlert("前車移動了");
    state.alertHoldUntil = now + 3200;
    state.armed = false;
    state.stoppedSince = 0;
  } else {
    setStatus("armed");
    setMessage("已待提醒。前車移動時會發出提示。");
  }

  state.rafId = requestAnimationFrame(analyzeFrame);
}

function analyzeCamera() {
  const videoWidth = els.video.videoWidth;
  const videoHeight = els.video.videoHeight;

  if (!videoWidth || !videoHeight) {
    return { red: 0, green: 0 };
  }

  const sampleWidth = 240;
  const sampleHeight = Math.round((sampleWidth / videoWidth) * videoHeight);
  const canvas = els.canvas;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  ctx.drawImage(els.video, 0, 0, sampleWidth, sampleHeight);

  const roi = {
    x: Math.round(state.roi.x * sampleWidth),
    y: Math.round(state.roi.y * sampleHeight),
    w: Math.round(state.roi.w * sampleWidth),
    h: Math.round(state.roi.h * sampleHeight),
  };

  const frame = ctx.getImageData(0, 0, sampleWidth, sampleHeight).data;
  const gray = toGray(frame, sampleWidth, sampleHeight);
  const metrics = scoreMotion(gray, state.previousGray, sampleWidth, sampleHeight, roi);
  state.previousGray = gray;

  return smoothMotionMetrics(metrics);
}

function analyzeDemo(now) {
  els.demoLight.classList.add("active");

  if (!state.demoStart) state.demoStart = now;
  const elapsed = now - state.demoStart;
  const moving = elapsed > Number(els.holdFrames.value) * 1000 + 1200;

  updateDemoVisual(moving);
  return moving
    ? { stability: 38, motion: 72, globalMotion: 8 }
    : { stability: 96, motion: 3, globalMotion: 2 };
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
  return {
    stability: Math.max(0, Math.round(100 - Math.max(globalMotion, roiMotion))),
    motion: roiMotion,
    globalMotion,
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

function smoothMotionMetrics(metrics) {
  state.smoothed.motion = state.smoothed.motion * 0.62 + metrics.motion * 0.38;
  state.smoothed.global = state.smoothed.global * 0.62 + metrics.globalMotion * 0.38;
  const motion = Math.round(state.smoothed.motion);
  const globalMotion = Math.round(state.smoothed.global);

  return {
    stability: Math.max(0, Math.round(100 - Math.max(motion, globalMotion))),
    motion,
    globalMotion,
  };
}

function resetMotionState() {
  state.previousGray = null;
  state.stoppedSince = 0;
  state.armed = false;
  state.demoStart = 0;
  state.alertHoldUntil = 0;
  state.smoothed.motion = 0;
  state.smoothed.global = 0;
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

function updateRoiFromControls() {
  const x = Number(els.roiX.value) / 100;
  const y = Number(els.roiY.value) / 100;
  const w = Number(els.roiW.value) / 100;
  const h = Number(els.roiH.value) / 100;

  state.roi = {
    x: Math.min(x, 1 - w),
    y: Math.min(y, 1 - h),
    w,
    h,
  };

  els.roiBox.style.left = `${state.roi.x * 100}%`;
  els.roiBox.style.top = `${state.roi.y * 100}%`;
  els.roiBox.style.width = `${state.roi.w * 100}%`;
  els.roiBox.style.height = `${state.roi.h * 100}%`;
}

function updateMeters(red, green) {
  els.redMeter.value = red;
  els.greenMeter.value = green;
  els.redValue.textContent = red;
  els.greenValue.textContent = green;
}

function setStatus(status) {
  els.stateBadge.textContent = statusText[status] || statusText.idle;
  els.stateBadge.className = `state-badge ${status}`;
}

function setMessage(text) {
  els.message.textContent = text;
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
