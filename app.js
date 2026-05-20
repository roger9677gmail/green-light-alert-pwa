const $ = (id) => document.getElementById(id);

const els = {
  video: $("camera"),
  canvas: $("analysisCanvas"),
  roiBox: $("roiBox"),
  flash: $("flash"),
  demoLight: $("demoLight"),
  stateBadge: $("stateBadge"),
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
};

const state = {
  running: false,
  stream: null,
  rafId: 0,
  audio: null,
  wakeLock: null,
  audioUnlocked: false,
  greenStreak: 0,
  lastAlertAt: 0,
  demoPhase: "red",
  demoLastFlip: 0,
  roi: { x: 0.35, y: 0.05, w: 0.3, h: 0.58 },
};

const statusText = {
  idle: "待機",
  camera: "相機",
  red: "紅燈",
  green: "綠燈",
  watching: "偵測",
  demo: "模擬",
};

init();

function init() {
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
    triggerAlert("測試提醒");
  });
  els.notifyToggle.addEventListener("change", requestNotificationPermission);
  els.demoToggle.addEventListener("change", () => {
    stopCameraStream();
    state.greenStreak = 0;
    setMessage(els.demoToggle.checked ? "模擬模式已開啟，可測試紅燈轉綠燈提醒。" : "請固定手機，讓框線只包住紅綠燈。");
    updateDemoVisual(performance.now());
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
  state.greenStreak = 0;
  state.lastAlertAt = 0;
  els.startBtn.textContent = "停止偵測";
  const audioReady = await unlockAudio();

  if (!els.demoToggle.checked) {
    try {
      await startCamera();
    } catch (error) {
      state.running = false;
      els.startBtn.textContent = "開始偵測";
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
  setMessage("相機已啟動。框線對準號誌後保持停止等待。");
}

function stopDetection() {
  state.running = false;
  cancelAnimationFrame(state.rafId);
  stopCameraStream();
  releaseWakeLock();
  els.startBtn.textContent = "開始偵測";
  state.greenStreak = 0;
  updateMeters(0, 0);
  setStatus("idle");
  setMessage("偵測已停止。");
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

  const scores = els.demoToggle.checked ? analyzeDemo(now) : analyzeCamera();
  updateMeters(scores.red, scores.green);

  const sensitivity = Number(els.sensitivity.value);
  const holdFrames = Number(els.holdFrames.value);
  const margin = Math.max(8, 80 - sensitivity);
  const hasGreen = scores.green > sensitivity && scores.green > scores.red + margin;
  const hasRed = scores.red > sensitivity && scores.red >= scores.green;

  if (hasGreen) {
    state.greenStreak += 1;
    setStatus("green");
    if (state.greenStreak >= holdFrames) {
      triggerAlert("綠燈了");
      state.greenStreak = Math.ceil(holdFrames / 2);
    }
  } else {
    state.greenStreak = 0;
    setStatus(hasRed ? "red" : els.demoToggle.checked ? "demo" : "watching");
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

  const pixels = ctx.getImageData(roi.x, roi.y, roi.w, roi.h).data;
  return scorePixels(pixels);
}

function analyzeDemo(now) {
  els.demoLight.classList.add("active");

  if (!state.demoLastFlip) state.demoLastFlip = now;
  if (now - state.demoLastFlip > 4200) {
    state.demoPhase = state.demoPhase === "red" ? "green" : "red";
    state.demoLastFlip = now;
  }

  updateDemoVisual(now);
  return state.demoPhase === "green" ? { red: 5, green: 86 } : { red: 82, green: 6 };
}

function updateDemoVisual(now) {
  els.demoLight.classList.toggle("active", els.demoToggle.checked);
  els.demoLight.classList.toggle("red-on", state.demoPhase === "red");
  els.demoLight.classList.toggle("green-on", state.demoPhase === "green");

  if (els.demoToggle.checked && !state.running) {
    state.demoPhase = now % 6000 > 3000 ? "green" : "red";
  }
}

function scorePixels(pixels) {
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

function rgbToHue(r, g, b, max, delta) {
  if (delta === 0) return 0;
  let hue;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return (hue * 60 + 360) % 360;
}

function triggerAlert(label) {
  const now = Date.now();
  if (now - state.lastAlertAt < 2600 && label !== "測試提醒") return;
  state.lastAlertAt = now;

  setMessage(`${label}。請確認路況後再起步。`);
  els.flash.classList.remove("active");
  void els.flash.offsetWidth;
  els.flash.classList.add("active");

  if (els.soundToggle.checked) {
    playTone();
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
  if (!AudioCtor) {
    els.soundToggle.checked = false;
    els.soundToggle.disabled = true;
    return false;
  }

  if (!state.audio) {
    state.audio = new AudioCtor();
  }

  try {
    if (state.audio.state === "suspended") {
      await state.audio.resume();
    }
    primeAudio();
    state.audioUnlocked = true;
    return true;
  } catch {
    state.audioUnlocked = false;
    return false;
  }
}

function playTone() {
  if (!state.audio || !state.audioUnlocked) return;

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

function primeAudio() {
  if (!state.audio) return;

  const audio = state.audio;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, audio.currentTime);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(audio.currentTime);
  oscillator.stop(audio.currentTime + 0.035);
}

function detectFeedbackSupport() {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) {
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
    navigator.serviceWorker.register("./sw.js").catch(() => {
      setMessage("離線快取尚未啟用，但偵測功能仍可使用。");
    });
  }
}
