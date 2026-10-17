/* ══════════════════════════════════════════════
   FaceAttend — app.js
   Full functionality: camera capture, upload,
   face recognition, attendance, export
══════════════════════════════════════════════ */

const API = "http://127.0.0.1:5000";

// ── State ────────────────────────────────────
let students = JSON.parse(localStorage.getItem("fa_students") || "[]");
let attendanceHistory = JSON.parse(localStorage.getItem("fa_attendance_history") || "[]")
  .filter(record => record && Array.isArray(record.presentRolls));
let classImageFile  = null;
let capturedDataURL = null;   // student photo (camera or upload)
let classDataURL    = null;   // class image data url for canvas
let lastResult      = null;

let camStream       = null;   // student camera stream
let classCamStream  = null;   // class camera stream
let studentCameraStarting = false;
let classCameraStarting = false;
let captureMode     = "camera"; // "camera" | "upload"
let classCaptureMode= "upload"; // "upload" | "camera"

// ── DOM ──────────────────────────────────────
const $ = id => document.getElementById(id);

// NAV
const navBtns     = document.querySelectorAll(".nav-btn");
const pages       = document.querySelectorAll(".page");
const topbarTitle = $("topbar-title");

// BACKEND STATUS
const backendStatusText = $("backend-status-text");
const backendPill       = $("backend-pill");
const pillLabel         = $("pill-label");

// NOTIFICATIONS
const notifZone = $("notif-zone");

// KPI
const kpiTotal   = $("kpi-total");
const kpiPresent = $("kpi-present");
const kpiAbsent  = $("kpi-absent");
const kpiRate    = $("kpi-rate");

// CAMERA (student)
const camVideo      = $("camera-video");
const camCanvas     = $("camera-canvas");
const startCamBtn   = $("start-cam-btn");
const studentCameraSelect = $("student-camera-select");
const captureBtn    = $("capture-btn");
const retakeBtn     = $("retake-btn");
const capturedPreview = $("captured-preview");
const camStatus     = $("camera-status");

// UPLOAD (student)
const regFileInput    = $("reg-file-input");
const regDropzone     = $("reg-dropzone");
const uploadPreview   = $("upload-preview");

// TABS
const tabCamera = $("tab-camera");
const tabUpload = $("tab-upload");
const cameraPanel = $("camera-panel");
const uploadPanel = $("upload-panel");

// FORM
const rollInput    = $("roll-input");
const nameInput    = $("name-input");
const registerBtn  = $("register-btn");

// ENROLLED
const enrolledCountBadge = $("enrolled-count-badge");
const navCount           = $("nav-count");
const navTotal           = $("nav-total");
const enrolledMiniList   = $("enrolled-mini-list");
const clearAllBtn        = $("clear-all-btn");

// CLASS CAMERA
const classVideo       = $("class-video");
const classCanvas      = $("class-canvas");
const startClassCamBtn = $("start-class-cam-btn");
const classCameraSelect = $("class-camera-select");
const classCameraStatus = $("class-camera-status");
const captureClassBtn  = $("capture-class-btn");
const retakeClassBtn   = $("retake-class-btn");

// CLASS TABS
const classTabUpload = $("class-tab-upload");
const classTabCamera = $("class-tab-camera");
const classUploadPanel = $("class-upload-panel");
const classCameraPanel = $("class-camera-panel");

// CLASS UPLOAD
const classFileInput = $("class-file-input");
const classDropzone  = $("class-dropzone");
const classPreview   = $("class-preview");

// PROCESS
const processBtn     = $("process-btn");
const processLabel   = $("process-label");
const processSpinner = $("process-spinner");
const processIcon    = $("process-icon");

// DASHBOARD
const canvasPlaceholder = $("canvas-placeholder");
const resultCanvas      = $("result-canvas");
const attendanceList    = $("attendance-list");
const fullAttendanceList= $("full-attendance-list");

// EXPORT
const exportBtn = $("export-btn");

// TIME
const timeDisplay = $("time-display");
const sessionDate = $("session-date");
const statFaces = $("stat-faces");
const statIdentified = $("stat-identified");
const statUnmatched = $("stat-unmatched");
const statDuration = $("stat-duration");
const statSimilarity = $("stat-similarity");
const trendRange = $("trend-range");
const trendChart = $("attendance-trend-chart");
const distributionChart = $("attendance-distribution-chart");
const historyScanCount = $("history-scan-count");
const historyAverageRate = $("history-average-rate");

const cameraPreferences = {
  student: studentCameraSelect,
  class: classCameraSelect,
};

// ── Time clock ───────────────────────────────
function updateTime() {
  const now = new Date();
  timeDisplay.textContent = now.toLocaleTimeString("en-GB", { hour12: false });
  sessionDate.textContent = now.toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  }).toUpperCase();
}
setInterval(updateTime, 1000);
updateTime();

// ── Background particle canvas ───────────────
(function initBG() {
  const canvas = $("bg-canvas");
  const ctx = canvas.getContext("2d");
  let W, H, dots = [];

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener("resize", resize);

  for (let i = 0; i < 60; i++) {
    dots.push({
      x: Math.random() * 1920,
      y: Math.random() * 1080,
      r: Math.random() * 1.2 + .3,
      vx: (Math.random() - .5) * .15,
      vy: (Math.random() - .5) * .15,
      a: Math.random() * .4 + .1,
    });
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    dots.forEach(d => {
      d.x += d.vx; d.y += d.vy;
      if (d.x < 0) d.x = W; if (d.x > W) d.x = 0;
      if (d.y < 0) d.y = H; if (d.y > H) d.y = 0;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,255,200,${d.a})`;
      ctx.fill();
    });
    // draw connections
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        const dx = dots[i].x - dots[j].x;
        const dy = dots[i].y - dots[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 120) {
          ctx.beginPath();
          ctx.moveTo(dots[i].x, dots[i].y);
          ctx.lineTo(dots[j].x, dots[j].y);
          ctx.strokeStyle = `rgba(0,255,200,${0.08 * (1 - dist / 120)})`;
          ctx.lineWidth = .5;
          ctx.stroke();
        }
      }
    }
    requestAnimationFrame(draw);
  }
  draw();
})();

// ── Notifications ─────────────────────────────
function notify(msg, type = "info") {
  const icons = {
    success: `<svg viewBox="0 0 16 16" fill="none" width="14" height="14"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.3"/><path d="M5 8l2.5 2.5L11 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
    error:   `<svg viewBox="0 0 16 16" fill="none" width="14" height="14"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.3"/><path d="M6 6l4 4M10 6l-4 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
    info:    `<svg viewBox="0 0 16 16" fill="none" width="14" height="14"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.3"/><path d="M8 7.5v4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="8" cy="5.5" r=".8" fill="currentColor"/></svg>`,
  };
  const el = document.createElement("div");
  el.className = `notif ${type}`;
  el.innerHTML = (icons[type] || "") + msg;
  notifZone.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

// ── Backend ping ──────────────────────────────
async function ping() {
  try {
    const res = await fetch(API + "/ping", { signal: AbortSignal.timeout(3000) });
    const d = await res.json();
    if (d.status === "ok") {
      backendStatusText.textContent = "Backend online";
      backendPill.className = "backend-pill online";
      pillLabel.textContent = "ONLINE";
    }
  } catch {
    backendStatusText.textContent = "Backend offline";
    backendPill.className = "backend-pill offline";
    pillLabel.textContent = "OFFLINE";
  }
}
ping();
setInterval(ping, 8000);

const laptopCameraPattern = /integrated|built.?in|internal|laptop|notebook|front.?camera|face.?time|wide.?vision|true.?vision|easy.?camera|(?:hp|dell|lenovo|acer|asus|microsoft|surface|chicony|realtek|intel).*camera|camera.*(?:hp|dell|lenovo|acer|asus|microsoft|surface|chicony|realtek|intel)/i;
const virtualCameraPattern = /phone.?link|link.?to.?windows|v\d{4}|virtual|obs|snap.?camera|manycam|droidcam|iriun|epoccam|continuity.?camera|camo.?camera|splitcam|xsplit/i;
const laptopCameraUnavailableMessage =
  "Windows is offering the Phone Link/virtual camera instead of the laptop webcam. Turn off Link to Windows/Phone Link, then enable Camera access and “Let desktop apps access your camera” in Windows Settings > Privacy & security > Camera. Reload the page and select the integrated camera.";

function savedCameraId(role) {
  return localStorage.getItem(`fa_camera_${role}`) || "";
}

async function availableCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    throw new Error("Camera access is not supported by this browser.");
  }
  return (await navigator.mediaDevices.enumerateDevices())
    .filter(device => device.kind === "videoinput");
}

function preferredCamera(devices) {
  const physicalCameras = devices.filter(device => !virtualCameraPattern.test(device.label));
  return physicalCameras.find(device => laptopCameraPattern.test(device.label))
    || (physicalCameras.length === 1 ? physicalCameras[0] : null);
}

async function refreshCameraChoices(role, selectedId = "") {
  const select = cameraPreferences[role];
  const allDevices = await availableCameras();
  const devices = allDevices.filter(device => !virtualCameraPattern.test(device.label));
  const savedId = savedCameraId(role);
  const preferred = preferredCamera(devices);
  const selected = devices.some(device => device.deviceId === selectedId)
    ? selectedId
    : devices.some(device => device.deviceId === savedId)
      ? savedId
      : preferred?.deviceId || "";

  select.replaceChildren();
  if (!allDevices.length) {
    select.add(new Option("No camera detected", ""));
    select.disabled = true;
    return { devices, selected };
  }

  if (!devices.length) {
    select.add(new Option("Phone Link camera ignored — no laptop camera found", ""));
    select.disabled = true;
    return { devices, selected };
  }

  select.disabled = false;
  select.add(new Option("Choose the laptop camera…", ""));
  devices.forEach((device, index) => {
    select.add(new Option(device.label || `Camera ${index + 1}`, device.deviceId));
  });
  select.value = selected || "";
  return { devices, selected };
}

async function preferLaptopCamera(role, currentStream) {
  const allDevices = await availableCameras();
  const devices = allDevices.filter(device => !virtualCameraPattern.test(device.label));
  const activeTrack = currentStream.getVideoTracks()[0];
  const activeId = activeTrack?.getSettings().deviceId || "";
  const activeLabel = activeTrack?.label || allDevices.find(device => device.deviceId === activeId)?.label || "";
  const virtualDetected = virtualCameraPattern.test(activeLabel)
    || allDevices.some(device => virtualCameraPattern.test(device.label));
  const savedId = savedCameraId(role);
  const savedDevice = devices.find(device => device.deviceId === savedId);
  const preferred = savedDevice || preferredCamera(devices);
  if (!preferred && virtualDetected) {
    throw new Error(laptopCameraUnavailableMessage);
  }
  if (!preferred) {
    await refreshCameraChoices(role);
    throw new Error(
      "Windows has more than one unnamed camera. Choose your laptop webcam in Camera Source, then start the camera again."
    );
  }
  const preferredId = preferred?.deviceId || activeId;
  await refreshCameraChoices(role, preferredId);

  if (preferredId === activeId) {
    if (preferredId && preferred) localStorage.setItem(`fa_camera_${role}`, preferredId);
    updateCameraStatus(role, activeTrack, preferred?.label || activeLabel);
    return currentStream;
  }

  let preferredStream;
  try {
    preferredStream = await navigator.mediaDevices.getUserMedia(cameraConstraints(preferredId));
    await setCameraStream(role, preferredStream);
    currentStream.getTracks().forEach(track => track.stop());
    localStorage.setItem(`fa_camera_${role}`, preferredId);
    updateCameraStatus(role, preferredStream.getVideoTracks()[0], preferred.label);
    return preferredStream;
  } catch {
    if (preferredStream) preferredStream.getTracks().forEach(track => track.stop());
    const video = role === "student" ? camVideo : classVideo;
    video.srcObject = currentStream;
    try { await video.play(); } catch { /* Keep the existing stream if playback is interrupted. */ }
    await refreshCameraChoices(role, activeId);
    updateCameraStatus(role, activeTrack, activeLabel);
    notify("Could not switch to the laptop camera; keeping the current camera active.", "info");
    return currentStream;
  }
}

function updateCameraStatus(role, track, knownLabel = "") {
  const label = knownLabel || track?.label || "";
  const isLaptopCamera = laptopCameraPattern.test(label);
  const status = isLaptopCamera
    ? `Laptop camera ready · ${label}`
    : `Camera active · verify source: ${label || "unknown device"}`;
  if (role === "student") camStatus.textContent = status;
  else classCameraStatus.textContent = status;
}

function cameraConstraints(deviceId = "") {
  return {
    audio: false,
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "user" } }),
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  };
}

function setCameraStream(role, stream) {
  const video = role === "student" ? camVideo : classVideo;
  video.srcObject = stream;
  video.style.display = "block";
  return video.play().then(() => waitForVideoFrame(video));
}

function waitForVideoFrame(video, timeoutMs = 15000) {
  if (video.videoWidth > 0 && video.videoHeight > 0
      && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let animationFrame = 0;
    const cleanup = () => {
      clearTimeout(timeout);
      clearInterval(poll);
      if (animationFrame) cancelAnimationFrame(animationFrame);
      video.removeEventListener("loadeddata", checkReady);
      video.removeEventListener("canplay", checkReady);
      video.removeEventListener("playing", checkReady);
      video.removeEventListener("resize", checkReady);
      video.removeEventListener("error", handleError);
    };
    const checkReady = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0
          && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        cleanup();
        resolve();
        return;
      }
      if (video.srcObject && !animationFrame) {
        animationFrame = requestAnimationFrame(() => {
          animationFrame = 0;
          checkReady();
        });
      }
    };
    const handleError = () => {
      cleanup();
      reject(new Error("The camera video could not be started. Stop it and try again."));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(
        "The camera connected but no video frames arrived. Check the camera privacy shutter and close apps using the camera, then try again."
      ));
    }, timeoutMs);
    const poll = setInterval(checkReady, 100);
    video.addEventListener("loadeddata", checkReady);
    video.addEventListener("canplay", checkReady);
    video.addEventListener("playing", checkReady);
    video.addEventListener("resize", checkReady);
    video.addEventListener("error", handleError);
    checkReady();
  });
}

function cameraErrorMessage(error) {
  if (error.name === "NotAllowedError" || error.name === "SecurityError") {
    return "Camera permission was blocked. Allow camera access in your browser settings and try again.";
  }
  if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
    return "No camera was found. Connect or enable the laptop camera and try again.";
  }
  if (error.name === "NotReadableError" || error.name === "TrackStartError") {
    return "The selected camera is busy in another app. Close other camera apps and retry.";
  }
  return error.message || "Unable to open the selected camera.";
}

async function switchCamera(role, deviceId) {
  const video = role === "student" ? camVideo : classVideo;
  const oldStream = role === "student" ? camStream : classCamStream;
  let newStream;
  const captureControl = role === "student" ? captureBtn : captureClassBtn;
  captureControl.disabled = true;
  try {
    newStream = await navigator.mediaDevices.getUserMedia(cameraConstraints(deviceId));
    if (role === "student") camStatus.textContent = "Starting selected camera…";
    else classCameraStatus.textContent = "Starting selected camera…";
    await setCameraStream(role, newStream);
    if (oldStream) oldStream.getTracks().forEach(track => track.stop());
    localStorage.setItem(`fa_camera_${role}`, deviceId);
    const cameraName = cameraPreferences[role].selectedOptions[0]?.textContent || "";
    updateCameraStatus(role, newStream.getVideoTracks()[0], cameraName);
    if (role === "student") {
      camStream = newStream;
      startCamBtn.textContent = "Stop Camera";
      captureBtn.disabled = false;
    } else {
      classCamStream = newStream;
      startClassCamBtn.textContent = "Stop Camera";
      captureClassBtn.disabled = false;
    }
    notify("Camera source changed.", "success");
  } catch (error) {
    if (newStream) newStream.getTracks().forEach(track => track.stop());
    video.srcObject = oldStream;
    if (oldStream) {
      try { await video.play(); } catch { /* Keep the existing stream if playback is interrupted. */ }
      captureControl.disabled = false;
    } else {
      captureControl.disabled = true;
    }
    notify(cameraErrorMessage(error), "error");
    await refreshCameraChoices(role, oldStream?.getVideoTracks()[0]?.getSettings().deviceId || "");
  }
}

// ── Navigation ────────────────────────────────
const titleMap = {
  dashboard:  "DASHBOARD",
  register:   "REGISTER",
  upload:     "UPLOAD",
  attendance: "ATTENDANCE",
};

navBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    const sec = btn.dataset.section;
    if (sec !== "register" && camStream) stopStudentCamera();
    if (sec !== "upload" && classCamStream) stopClassCamera();
    navBtns.forEach(b => b.classList.remove("active"));
    pages.forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    $("section-" + sec).classList.add("active");
    topbarTitle.textContent = titleMap[sec] || sec.toUpperCase();
    if (sec === "dashboard")  renderDashboard();
    if (sec === "register")   renderEnrolledList();
    if (sec === "attendance") renderFullAttendance();
  });
});

trendRange.addEventListener("change", renderTrendChart);

// ── localStorage ─────────────────────────────
function saveStudents() {
  localStorage.setItem("fa_students", JSON.stringify(students));
  updateCounts();
}

function updateCounts() {
  const n = students.length;
  navCount.textContent = n;
  navTotal.textContent = n;
  enrolledCountBadge.textContent = n;
  kpiTotal.textContent = n;
}

// ══════════════════════════════════════════════
//  STUDENT CAMERA
// ══════════════════════════════════════════════
async function startStudentCamera() {
  if (camStream || studentCameraStarting) return;
  studentCameraStarting = true;
  startCamBtn.disabled = true;
  captureBtn.disabled = true;
  camStatus.textContent = "Starting laptop camera…";
  let stream;
  try {
    const devices = await availableCameras();
    await refreshCameraChoices("student");
    const storedId = savedCameraId("student");
    const safeDevices = devices.filter(device => !virtualCameraPattern.test(device.label));
    const selectedId = storedId || cameraPreferences.student.value;
    const remembered = safeDevices.find(device => device.deviceId === selectedId);
    const hasOnlyVirtualCameras = devices.length > 0
      && devices.every(device => device.label && virtualCameraPattern.test(device.label));
    if (hasOnlyVirtualCameras) {
      throw new Error(laptopCameraUnavailableMessage);
    }
    const preferred = devices.some(device => device.label) ? preferredCamera(safeDevices) : null;
    const target = remembered || preferred || (safeDevices.length === 1 ? safeDevices[0] : null);
    if (!target && safeDevices.length > 1) {
      throw new Error("Choose your laptop webcam in Camera Source before starting the camera.");
    }
    stream = await navigator.mediaDevices.getUserMedia(cameraConstraints(target?.deviceId || ""));
    await setCameraStream("student", stream);
    camStream = stream;
    camCanvas.style.display = "none";
    capturedPreview.style.display = "none";
    startCamBtn.textContent = "Stop Camera";
    retakeBtn.style.display = "none";
    camStatus.textContent = "Waiting for the first camera frame…";
    capturedDataURL = null;
    camStream = await preferLaptopCamera("student", camStream);
    captureBtn.disabled = false;
  } catch (e) {
    if (stream) stream.getTracks().forEach(track => track.stop());
    camStream = null;
    camVideo.srcObject = null;
    camVideo.style.display = "none";
    startCamBtn.textContent = "Start Camera";
    captureBtn.disabled = true;
    camStatus.textContent = "Laptop camera not available";
    notify(cameraErrorMessage(e), "error");
  } finally {
    studentCameraStarting = false;
    startCamBtn.disabled = false;
  }
}

function stopStudentCamera() {
  if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
  camVideo.srcObject = null;
  camVideo.style.display = "none";
  captureBtn.disabled = true;
  camStatus.textContent = "Camera off";
  startCamBtn.textContent = "Start Camera";
}

async function captureStudentPhoto() {
  if (!camStream) return;
  captureBtn.disabled = true;
  try {
    await waitForVideoFrame(camVideo);
    const w = camVideo.videoWidth;
    const h = camVideo.videoHeight;
    camCanvas.width = w; camCanvas.height = h;
    const ctx = camCanvas.getContext("2d");
    ctx.save();
    ctx.translate(w, 0); ctx.scale(-1, 1);
    ctx.drawImage(camVideo, 0, 0);
    ctx.restore();
    capturedDataURL = camCanvas.toDataURL("image/jpeg", .92);
    capturedPreview.src = capturedDataURL;
    capturedPreview.style.display = "block";
    stopStudentCamera();
    retakeBtn.style.display = "flex";
    captureBtn.style.display = "none";
    startCamBtn.style.display = "none";
    camStatus.textContent = "Photo captured";
  } catch (error) {
    notify(error.message, "error");
    captureBtn.disabled = !camStream;
  }
}

startCamBtn.addEventListener("click", () => camStream ? stopStudentCamera() : startStudentCamera());
captureBtn.addEventListener("click", captureStudentPhoto);
retakeBtn.addEventListener("click", () => {
  capturedDataURL = null;
  capturedPreview.style.display = "none";
  retakeBtn.style.display = "none";
  captureBtn.style.display = "flex";
  startCamBtn.style.display = "flex";
  camStatus.textContent = "Camera off";
  startStudentCamera();
});

studentCameraSelect.addEventListener("change", () => {
  if (!studentCameraSelect.value) return;
  if (camStream) switchCamera("student", studentCameraSelect.value);
  else localStorage.setItem("fa_camera_student", studentCameraSelect.value);
});

// ── Student upload tab ─────────────────────────
tabCamera.addEventListener("click", () => {
  tabCamera.classList.add("active"); tabUpload.classList.remove("active");
  cameraPanel.style.display = "flex"; uploadPanel.style.display = "none";
  captureMode = "camera";
  capturedDataURL = null;
  uploadPreview.style.display = "none";
});
tabUpload.addEventListener("click", () => {
  tabUpload.classList.add("active"); tabCamera.classList.remove("active");
  uploadPanel.style.display = "flex"; cameraPanel.style.display = "none";
  captureMode = "upload";
  stopStudentCamera();
});

regFileInput.addEventListener("change", () => {
  const f = regFileInput.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = e => {
    capturedDataURL = e.target.result;
    uploadPreview.src = e.target.result;
    uploadPreview.style.display = "block";
  };
  reader.readAsDataURL(f);
});

// drag-drop for student upload
regDropzone.addEventListener("dragover", e => { e.preventDefault(); });
regDropzone.addEventListener("drop", e => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f && f.type.startsWith("image/")) {
    const dt = new DataTransfer(); dt.items.add(f);
    regFileInput.files = dt.files;
    regFileInput.dispatchEvent(new Event("change"));
  }
});

// ── Register student ──────────────────────────
registerBtn.addEventListener("click", () => {
  const roll = rollInput.value.trim();
  const name = nameInput.value.trim();
  if (!roll) { notify("Enter a roll number first.", "error"); return; }
  if (!capturedDataURL) { notify("Capture or upload a student photo first.", "error"); return; }
  if (students.find(s => s.roll === roll)) { notify(`Roll ${roll} already registered.`, "error"); return; }

  students.push({ roll, name: name || roll, image: capturedDataURL });
  saveStudents();
  rollInput.value = ""; nameInput.value = "";
  capturedDataURL = null;
  capturedPreview.style.display = "none";
  uploadPreview.style.display = "none";
  retakeBtn.style.display = "none";
  captureBtn.style.display = "flex";
  startCamBtn.style.display = "flex";
  renderEnrolledList();
  notify(`Student ${roll} enrolled successfully.`, "success");
});

// ── Enrolled list ─────────────────────────────
function renderEnrolledList() {
  updateCounts();
  if (!students.length) {
    enrolledMiniList.innerHTML = `<div class="empty-state small"><p>No students yet</p></div>`;
    return;
  }
  enrolledMiniList.innerHTML = students.map((s, i) => `
    <div class="em-row">
      <span class="em-roll">${s.roll}</span>
      <span class="em-name">${s.name !== s.roll ? s.name : ""}</span>
      <button class="em-del" data-i="${i}">×</button>
    </div>
  `).join("");
  enrolledMiniList.querySelectorAll(".em-del").forEach(btn => {
    btn.addEventListener("click", () => {
      students.splice(+btn.dataset.i, 1);
      saveStudents();
      renderEnrolledList();
    });
  });
}

clearAllBtn.addEventListener("click", () => {
  if (!students.length) return;
  if (!confirm("Delete all enrolled students?")) return;
  students = []; saveStudents(); renderEnrolledList();
  notify("All students cleared.", "info");
});

// ══════════════════════════════════════════════
//  CLASS IMAGE CAMERA
// ══════════════════════════════════════════════
classTabUpload.addEventListener("click", () => {
  classTabUpload.classList.add("active"); classTabCamera.classList.remove("active");
  classUploadPanel.style.display = "block"; classCameraPanel.style.display = "none";
  classCaptureMode = "upload";
  stopClassCamera();
});
classTabCamera.addEventListener("click", () => {
  classTabCamera.classList.add("active"); classTabUpload.classList.remove("active");
  classCameraPanel.style.display = "block"; classUploadPanel.style.display = "none";
  classCaptureMode = "camera";
  classDataURL = null; classImageFile = null;
  classPreview.style.display = "none";
  processBtn.style.display = "none";
});

async function startClassCamera() {
  if (classCamStream || classCameraStarting) return;
  classCameraStarting = true;
  startClassCamBtn.disabled = true;
  captureClassBtn.disabled = true;
  classCameraStatus.textContent = "Starting laptop camera…";
  let stream;
  try {
    const devices = await availableCameras();
    await refreshCameraChoices("class");
    const storedId = savedCameraId("class");
    const safeDevices = devices.filter(device => !virtualCameraPattern.test(device.label));
    const selectedId = storedId || cameraPreferences.class.value;
    const remembered = safeDevices.find(device => device.deviceId === selectedId);
    const hasOnlyVirtualCameras = devices.length > 0
      && devices.every(device => device.label && virtualCameraPattern.test(device.label));
    if (hasOnlyVirtualCameras) {
      throw new Error(laptopCameraUnavailableMessage);
    }
    const preferred = devices.some(device => device.label) ? preferredCamera(safeDevices) : null;
    const target = remembered || preferred || (safeDevices.length === 1 ? safeDevices[0] : null);
    if (!target && safeDevices.length > 1) {
      throw new Error("Choose your laptop webcam in Camera Source before starting the camera.");
    }
    stream = await navigator.mediaDevices.getUserMedia(cameraConstraints(target?.deviceId || ""));
    await setCameraStream("class", stream);
    classCamStream = stream;
    classCanvas.style.display = "none";
    startClassCamBtn.textContent = "Stop Camera";
    retakeClassBtn.style.display = "none";
    classCameraStatus.textContent = "Waiting for the first camera frame…";
    classCamStream = await preferLaptopCamera("class", classCamStream);
    captureClassBtn.disabled = false;
  } catch (error) {
    if (stream) stream.getTracks().forEach(track => track.stop());
    classCamStream = null;
    classVideo.srcObject = null;
    classVideo.style.display = "none";
    startClassCamBtn.textContent = "Start Camera";
    captureClassBtn.disabled = true;
    classCameraStatus.textContent = "Laptop camera not available";
    notify(cameraErrorMessage(error), "error");
  } finally {
    classCameraStarting = false;
    startClassCamBtn.disabled = false;
  }
}

function stopClassCamera() {
  if (classCamStream) { classCamStream.getTracks().forEach(t => t.stop()); classCamStream = null; }
  classVideo.srcObject = null;
  classVideo.style.display = "none";
  captureClassBtn.disabled = true;
  startClassCamBtn.textContent = "Start Camera";
  classCameraStatus.textContent = "Camera off";
}

async function captureClassPhoto() {
  if (!classCamStream) return;
  captureClassBtn.disabled = true;
  try {
    await waitForVideoFrame(classVideo);
    const w = classVideo.videoWidth;
    const h = classVideo.videoHeight;
    classCanvas.width = w; classCanvas.height = h;
    classCanvas.getContext("2d").drawImage(classVideo, 0, 0);
    classDataURL = classCanvas.toDataURL("image/jpeg", .95);
    const blob = await new Promise(resolve => classCanvas.toBlob(resolve, "image/jpeg", .95));
    if (!blob) throw new Error("Could not create a photo from this camera.");
    classImageFile = new File([blob], "class_capture.jpg", { type: "image/jpeg" });
    classPreview.src = classDataURL;
    classPreview.style.display = "block";
    stopClassCamera();
    retakeClassBtn.style.display = "inline-flex";
    captureClassBtn.style.display = "none";
    startClassCamBtn.style.display = "none";
    processBtn.style.display = "flex";
    notify("Class photo captured.", "info");
  } catch (error) {
    notify(error.message, "error");
    captureClassBtn.disabled = !classCamStream;
  }
}

startClassCamBtn.addEventListener("click", () => classCamStream ? stopClassCamera() : startClassCamera());
captureClassBtn.addEventListener("click", captureClassPhoto);
retakeClassBtn.addEventListener("click", () => {
  classImageFile = null; classDataURL = null;
  classPreview.style.display = "none";
  processBtn.style.display = "none";
  retakeClassBtn.style.display = "none";
  captureClassBtn.style.display = "flex";
  startClassCamBtn.style.display = "flex";
  startClassCamera();
});

classCameraSelect.addEventListener("change", () => {
  if (!classCameraSelect.value) return;
  if (classCamStream) switchCamera("class", classCameraSelect.value);
  else localStorage.setItem("fa_camera_class", classCameraSelect.value);
});

if (navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener("devicechange", async () => {
    try {
      for (const role of ["student", "class"]) {
        const stream = role === "student" ? camStream : classCamStream;
        const activeId = stream?.getVideoTracks()[0]?.getSettings().deviceId || "";
        await refreshCameraChoices(role, activeId);
      }
    } catch (error) {
      notify(cameraErrorMessage(error), "error");
    }
  });
}

async function initializeCameraSelectors() {
  try {
    await Promise.all(Object.keys(cameraPreferences).map(role => refreshCameraChoices(role)));
  } catch (error) {
    for (const select of Object.values(cameraPreferences)) {
      select.replaceChildren(new Option("Camera list unavailable", ""));
      select.disabled = true;
    }
    notify(cameraErrorMessage(error), "error");
  }
}
initializeCameraSelectors();

// ── Class file upload ─────────────────────────
classFileInput.addEventListener("change", () => {
  const f = classFileInput.files[0];
  if (!f) return;
  loadClassFile(f);
});

function loadClassFile(f) {
  classImageFile = f;
  const reader = new FileReader();
  reader.onload = e => {
    classDataURL = e.target.result;
    classPreview.src = e.target.result;
    classPreview.style.display = "block";
    processBtn.style.display = "flex";
    notify("Class image loaded. Ready to process.", "info");
  };
  reader.readAsDataURL(f);
}

classDropzone.addEventListener("dragover", e => { e.preventDefault(); $("class-dropzone").querySelector(".bdz-inner").style.borderColor = "var(--cyan)"; });
classDropzone.addEventListener("dragleave", () => { $("class-dropzone").querySelector(".bdz-inner").style.borderColor = ""; });
classDropzone.addEventListener("drop", e => {
  e.preventDefault();
  $("class-dropzone").querySelector(".bdz-inner").style.borderColor = "";
  const f = e.dataTransfer.files[0];
  if (f && f.type.startsWith("image/")) loadClassFile(f);
});

// ── Process attendance ─────────────────────────
processBtn.addEventListener("click", async () => {
  if (!classImageFile) { notify("No class image loaded.", "error"); return; }
  if (!students.length) { notify("No students enrolled. Register students first.", "error"); return; }

  processLabel.textContent = "Processing…";
  processSpinner.style.display = "inline-block";
  processIcon.style.display = "none";
  processBtn.disabled = true;

  try {
    const scanStartedAt = performance.now();
    const fd = new FormData();
    fd.append("students", JSON.stringify(students.map(s => ({ roll: s.roll, image: s.image }))));
    fd.append("class_image", classImageFile, "class.jpg");

    const res = await fetch(API + "/process", { method: "POST", body: fd });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.error && !data.present.length) {
      notify("Backend: " + data.error, "error");
    } else {
      data.processingDurationMs = performance.now() - scanStartedAt;
      lastResult = data;
      saveAttendanceRecord(data);
      renderDashboard();
      renderFullAttendance();
      const skipped = data.skipped_students || 0;
      notify(
        skipped
          ? `Done! ${data.present.length}/${students.length} students present. ${skipped} student photo(s) could not be used.`
          : `Done! ${data.present.length}/${students.length} students present.`,
        skipped ? "info" : "success"
      );
      // Switch to dashboard
      navBtns.forEach(b => b.classList.remove("active"));
      pages.forEach(p => p.classList.remove("active"));
      document.querySelector('[data-section="dashboard"]').classList.add("active");
      $("section-dashboard").classList.add("active");
      topbarTitle.textContent = "DASHBOARD";
    }
  } catch (err) {
    notify("Connection failed: " + err.message, "error");
  } finally {
    processLabel.textContent = "Run Face Recognition";
    processSpinner.style.display = "none";
    processIcon.style.display = "block";
    processBtn.disabled = false;
  }
});

// ── Draw face boxes on canvas ─────────────────
function drawBoxes(imgSrc, boxes, matches) {
  const img = new Image();
  img.onload = () => {
    resultCanvas.width  = img.width;
    resultCanvas.height = img.height;
    const ctx = resultCanvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const lw = Math.max(2, img.width / 400);
    ctx.lineWidth = lw;
    ctx.font = `${Math.max(11, img.width / 60)}px "JetBrains Mono", monospace`;
    boxes.forEach(([top, right, bottom, left], idx) => {
      const match = matches[idx];
      const isMatched = Boolean(match);
      ctx.strokeStyle = isMatched ? "#22d67a" : "#ff4d6d";
      ctx.strokeRect(left, top, right - left, bottom - top);
      // label bg
      const lh = Math.max(18, img.width / 45);
      ctx.fillStyle = isMatched ? "#22d67aCC" : "#ff4d6dCC";
      ctx.fillRect(left, top - lh, right - left, lh);
      ctx.fillStyle = "#000";
      if (isMatched) ctx.fillText(match.roll, left + 4, top - 4);
    });
    canvasPlaceholder.style.display = "none";
    resultCanvas.style.display = "block";
  };
  img.src = imgSrc;
}

// ── Render dashboard ──────────────────────────
function renderDashboard() {
  updateCounts();
  const record = latestAttendanceRecord();
  historyScanCount.textContent = attendanceHistory.length;
  const averageRate = attendanceHistory.length
    ? Math.round(attendanceHistory.reduce((sum, item) => sum + item.rate, 0) / attendanceHistory.length)
    : null;
  historyAverageRate.textContent = averageRate == null ? "—" : `${averageRate}%`;

  if (!record) {
    for (const element of [statFaces, statIdentified, statUnmatched, statDuration, statSimilarity]) {
      element.textContent = "—";
    }
    kpiPresent.textContent = "—";
    kpiAbsent.textContent = "—";
    kpiRate.textContent = "—%";
    $("kpi-present-bar").style.width = "0%";
    $("kpi-absent-bar").style.width = "0%";
    $("kpi-rate-bar").style.width = "0%";
    attendanceList.innerHTML = `<div class="empty-state"><p>Take attendance to see the class roster and results.</p></div>`;
    canvasPlaceholder.style.display = "flex";
    resultCanvas.style.display = "none";
    renderTrendChart();
    renderDistributionChart(null);
    return;
  }

  statFaces.textContent = record.faceCount;
  statIdentified.textContent = record.identified;
  statUnmatched.textContent = record.unmatched;
  statDuration.textContent = `${(record.durationMs / 1000).toFixed(1)}s`;
  statSimilarity.textContent = record.avgSimilarity == null ? "—" : record.avgSimilarity.toFixed(3);

  const presentRolls = new Set(record.presentRolls);
  const total = record.total;
  const present = record.present;
  const absent = record.absent;
  const rate = record.rate;

  kpiPresent.textContent = present;
  kpiAbsent.textContent = absent;
  kpiRate.textContent = `${rate}%`;
  $("kpi-present-bar").style.width = `${total ? (present / total) * 100 : 0}%`;
  $("kpi-absent-bar").style.width = `${total ? (absent / total) * 100 : 0}%`;
  $("kpi-rate-bar").style.width = `${rate}%`;

  if (lastResult && classDataURL && lastResult.boxes?.length) {
    drawBoxes(classDataURL, lastResult.boxes, lastResult.matches || []);
  } else {
    canvasPlaceholder.style.display = "flex";
    resultCanvas.style.display = "none";
    canvasPlaceholder.querySelector("p").textContent = "Scan image preview is available until you leave this session.";
  }

  const snapshotRoster = Array.isArray(record.roster) ? record.roster : students;
  attendanceList.innerHTML = snapshotRoster
    .map(student => rowHTML(student, presentRolls.has(student.roll)))
    .join("") || `<div class="empty-state"><p>No students are currently enrolled.</p></div>`;

  renderTrendChart();
  renderDistributionChart(record);
}

function rowHTML(s, isPresent) {
  const init = (s.name || s.roll).slice(0, 2).toUpperCase();
  const avClass = isPresent ? "pres" : "abs";
  const badge   = isPresent
    ? `<span class="status-badge pres">PRESENT</span>`
    : `<span class="status-badge abs">ABSENT</span>`;
  return `
    <div class="student-row">
      <div class="s-info">
        <div class="s-avatar ${avClass}">${init}</div>
        <div>
          <div class="s-name">${s.name || s.roll}</div>
          ${s.name !== s.roll ? `<div class="s-roll">${s.roll}</div>` : ""}
        </div>
      </div>
      ${badge}
    </div>`;
}

// ── Full attendance ───────────────────────────
function renderFullAttendance() {
  const record = latestAttendanceRecord();
  if (!record) {
    fullAttendanceList.innerHTML = `<div class="empty-state"><p>Process a class image to generate report</p></div>`;
    return;
  }
  const presentRolls = new Set(record.presentRolls);
  const roster = Array.isArray(record.roster) ? record.roster : students;
  const presentStudents = roster.filter(s => presentRolls.has(s.roll));
  const absentStudents  = roster.filter(s => !presentRolls.has(s.roll));
  fullAttendanceList.innerHTML = [
    ...presentStudents.map(s => rowHTML(s, true)),
    ...absentStudents.map(s  => rowHTML(s, false)),
  ].join("") || `<div class="empty-state"><p>No data</p></div>`;
}

// ── Export CSV ────────────────────────────────
exportBtn.addEventListener("click", () => {
  const record = latestAttendanceRecord();
  if (!record) { notify("No attendance data to export.", "error"); return; }
  const rows = [["Date and time", "Roll", "Name", "Status"]];
  const presentRolls = new Set(record.presentRolls);
  const roster = Array.isArray(record.roster) ? record.roster : students;
  roster.forEach(student => {
    rows.push([
      new Date(record.timestamp).toLocaleString(),
      student.roll,
      student.name || "",
      presentRolls.has(student.roll) ? "Present" : "Absent",
    ]);
  });
  const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `attendance_${record.timestamp.slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  notify("CSV exported.", "success");
});

function latestAttendanceRecord() {
  return attendanceHistory[attendanceHistory.length - 1] || null;
}

function saveAttendanceRecord(result) {
  const presentRolls = [...new Set(result.present || [])];
  const matches = (result.matches || []).filter(Boolean);
  const scores = matches.map(match => Number(match.confidence)).filter(Number.isFinite);
  const total = students.length;
  const present = presentRolls.length;
  const record = {
    timestamp: new Date().toISOString(),
    total,
    present,
    absent: Math.max(0, total - present),
    rate: total ? Math.round((present / total) * 100) : 0,
    presentRolls,
    roster: students.map(student => ({ roll: student.roll, name: student.name || "" })),
    faceCount: (result.boxes || []).length,
    identified: matches.length,
    unmatched: Math.max(0, (result.boxes || []).length - matches.length),
    durationMs: Number(result.processingDurationMs) || 0,
    avgSimilarity: scores.length
      ? scores.reduce((sum, score) => sum + score, 0) / scores.length
      : null,
  };
  attendanceHistory.push(record);
  attendanceHistory = attendanceHistory.slice(-50);
  try {
    localStorage.setItem("fa_attendance_history", JSON.stringify(attendanceHistory));
  } catch (error) {
    notify(`Attendance was processed, but its history could not be saved: ${error.message}`, "error");
  }
}

function renderTrendChart() {
  if (!trendChart) return;
  const requestedCount = trendRange.value === "all" ? attendanceHistory.length : Number(trendRange.value);
  const records = attendanceHistory.slice(-requestedCount);
  if (!records.length) {
    trendChart.innerHTML = `<div class="chart-empty">Attendance rate will appear here after your first scan.</div>`;
    return;
  }

  const width = 720;
  const height = 250;
  const left = 42;
  const right = 16;
  const top = 18;
  const bottom = 42;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const points = records.map((record, index) => ({
    x: records.length === 1 ? left + plotWidth / 2 : left + (index / (records.length - 1)) * plotWidth,
    y: top + ((100 - record.rate) / 100) * plotHeight,
    record,
  }));
  const grid = [0, 25, 50, 75, 100].map(value => {
    const y = top + ((100 - value) / 100) * plotHeight;
    return `<line class="chart-gridline" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"/>
      <text class="chart-axis-label" x="${left - 9}" y="${y + 4}" text-anchor="end">${value}%</text>`;
  }).join("");
  const linePath = points.map((point, index) =>
    `${index ? "L" : "M"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`
  ).join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${top + plotHeight} L ${points[0].x} ${top + plotHeight} Z`;
  const pointMarkup = points.map((point, index) => {
    const date = new Date(point.record.timestamp);
    const label = date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const xLabel = records.length <= 7 || index === 0 || index === records.length - 1 || index % Math.ceil(records.length / 6) === 0;
    return `<circle class="chart-point" cx="${point.x}" cy="${point.y}" r="5" tabindex="0" aria-label="${label}: ${point.record.rate}% attendance">
        <title>${label}: ${point.record.present}/${point.record.total} present (${point.record.rate}%)</title>
      </circle>${xLabel ? `<text class="chart-axis-label chart-x-label" x="${point.x}" y="${height - 12}" text-anchor="middle">${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</text>` : ""}`;
  }).join("");

  trendChart.innerHTML = `<svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Attendance rate by scan, showing ${records.length} scans">
    <defs><linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--cyan)" stop-opacity=".22"/><stop offset="100%" stop-color="var(--cyan)" stop-opacity="0"/></linearGradient></defs>
    ${grid}<path class="chart-area" d="${areaPath}"/><path class="chart-line" d="${linePath}"/>${pointMarkup}
  </svg>`;
}

function renderDistributionChart(record) {
  if (!distributionChart) return;
  if (!record || !record.total) {
    distributionChart.innerHTML = `<div class="chart-empty">Roster distribution appears after attendance is processed.</div>`;
    return;
  }
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const presentLength = (record.present / record.total) * circumference;
  distributionChart.innerHTML = `<div class="distribution-visual">
    <svg class="donut-svg" viewBox="0 0 144 144" role="img" aria-label="${record.present} present and ${record.absent} absent out of ${record.total}">
      <circle class="donut-track" cx="72" cy="72" r="${radius}"/>
      <circle class="donut-present" cx="72" cy="72" r="${radius}" stroke-dasharray="${presentLength} ${circumference - presentLength}"/>
      <text class="donut-value" x="72" y="69" text-anchor="middle">${record.rate}%</text>
      <text class="donut-caption" x="72" y="88" text-anchor="middle">PRESENT</text>
    </svg>
    <div class="distribution-legend">
      <div><span class="legend-dot present"></span><span>Present</span><strong>${record.present}</strong></div>
      <div><span class="legend-dot absent"></span><span>Absent</span><strong>${record.absent}</strong></div>
      <small>Latest scan · ${new Date(record.timestamp).toLocaleString()}</small>
    </div>
  </div>`;
}

// ── Init ──────────────────────────────────────
updateCounts();
renderEnrolledList();
renderDashboard();
