// ============== SCHEDULE STATE ==============
let schedules = [];
let editingScheduleId = null;
let selectedAction = "open";
let selectedDays = [1, 2, 3, 4, 5];

// ============== STATE ==============
let userData = null;
let device = null;
let characteristic = null;
let windowOpen = false;
let isCalibrated = false;
let isConnected = false;
let isAuthenticated = false; // NEW: Track BLE authentication
let deviceId = null;
let pairToken = null; // NEW: Store the pairing token

// ============== CONFIG ==============
const SERVICE_UUID = 0x00ff;
const CHAR_UUID = 0xff01;
const DEVICE_NAME = "Auris";

// Connection commands
const CONN_CMD = {
  FIRST_TIME_PAIR: 0,
  NORMAL_CONNECT: 1,
};

// Motor/action commands (only work after authenticated)
const CMD = {
  CLOSE: 2,
  OPEN: 3,
  STOP: 4,
  RESET_ENCODER: 5,
  MOVE_FORWARD: 10,
  MOVE_BACKWARD: 11,
  SAVE_CALIBRATION: 20,
};

// ============== INITIALIZATION ==============
document.addEventListener("DOMContentLoaded", () => {
  loadUserData();
  loadStoredToken(); // NEW: Load token from localStorage
  initTabs();
  initModals();
  loadSchedules();
});

// ============== TOKEN STORAGE ==============
function loadStoredToken() {
  pairToken = localStorage.getItem("auris_pair_token");
  if (pairToken) {
    console.log("Loaded stored pair token");
  }
}

function saveToken(token) {
  pairToken = token;
  localStorage.setItem("auris_pair_token", token);
  console.log("Saved pair token to storage");
}

function clearToken() {
  pairToken = null;
  localStorage.removeItem("auris_pair_token");
  console.log("Cleared pair token");
}

// ============== BLE WRITE FUNCTIONS ==============
async function sendByte(cmd) {
  if (!characteristic) {
    console.error("No BLE connection");
    return false;
  }

  try {
    await characteristic.writeValue(new Uint8Array([cmd]));
    console.log("→ Sent byte:", cmd);
    return true;
  } catch (err) {
    console.error("Write failed:", err);
    return false;
  }
}

async function sendJSON(payload) {
  if (!characteristic) {
    console.error("No BLE connection");
    return false;
  }

  try {
    const jsonString = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(jsonString);
    await characteristic.writeValue(bytes);
    console.log("→ Sent JSON:", payload);
    return true;
  } catch (err) {
    console.error("Write failed:", err);
    return false;
  }
}

async function sendCommand(cmd) {
  if (!characteristic) {
    console.warn("Cannot send command: No BLE connection");
    return false;
  }

  if (!isAuthenticated && cmd >= 2) {
    console.warn("Cannot send command: Not authenticated");
    return false;
  }

  return sendByte(cmd);
}

// ============== BLE AUTHENTICATION ==============
async function authenticateFirstTime(token) {
  console.log("Starting first-time pairing...");

  // Step 1: Send command 0 (first time pair)
  const cmdSent = await sendByte(CONN_CMD.FIRST_TIME_PAIR);
  if (!cmdSent) {
    throw new Error("Failed to send pair command");
  }

  await delay(100);

  // Step 2: Send the token
  const tokenSent = await sendJSON({ token: token });
  if (!tokenSent) {
    throw new Error("Failed to send token");
  }

  await delay(500);

  // Step 3: Read state to check if authenticated
  const authStatus = await readAuthStatus();
  if (!authStatus) {
    throw new Error("Authentication failed - invalid token");
  }

  isAuthenticated = true;
  saveToken(token);
  console.log("✅ First-time pairing successful!");
  return true;
}

async function authenticateNormal(token) {
  console.log("Starting normal authentication...");

  // Step 1: Send command 1 (normal connect)
  const cmdSent = await sendByte(CONN_CMD.NORMAL_CONNECT);
  if (!cmdSent) {
    throw new Error("Failed to send connect command");
  }

  await delay(100);

  // Step 2: Send the token
  const tokenSent = await sendJSON({ token: token });
  if (!tokenSent) {
    throw new Error("Failed to send token");
  }

  await delay(500);

  // Step 3: Read state to check if authenticated
  const authStatus = await readAuthStatus();
  if (!authStatus) {
    throw new Error("Authentication failed - token mismatch");
  }

  isAuthenticated = true;
  console.log("✅ Normal authentication successful!");
  return true;
}

async function readAuthStatus() {
  if (!characteristic) return false;

  try {
    const value = await characteristic.readValue();

    // Read window state
    windowOpen = value.getUint8(0) === 1;

    // Read calibration state
    if (value.byteLength > 1) {
      isCalibrated = value.getUint8(1) === 1;
    }

    // Read battery (optional)
    if (value.byteLength > 2) {
      const batteryPercent = value.getUint8(2);
      console.log("Battery:", batteryPercent + "%");
    }

    // Read charging state (optional)
    if (value.byteLength > 3) {
      const isCharging = value.getUint8(3) === 1;
      console.log("Charging:", isCharging);
    }

    // Read authentication state (byte 4)
    if (value.byteLength > 4) {
      const authenticated = value.getUint8(4) === 1;
      console.log("Authenticated:", authenticated);
      return authenticated;
    }

    // If no auth byte, assume success if we got a response
    return true;
  } catch (e) {
    console.error("Read auth status error:", e);
    return false;
  }
}

// ============== LISTENERS ==============
document.getElementById("setupBtn").addEventListener("click", setupDevice);
document.getElementById("setup-logout").addEventListener("click", logout);
document
  .getElementById("firstCalibrationStartBtn")
  .addEventListener("click", startFirstCalibration);
document
  .getElementById("firstBackwardBtn")
  .addEventListener("mousedown", (event) => {
    startFirstMove(11, event);
  });
document
  .getElementById("firstBackwardBtn")
  .addEventListener("mouseup", stopFirstMove);
document
  .getElementById("firstBackwardBtn")
  .addEventListener("mouseleave", stopFirstMove);
document
  .getElementById("firstBackwardBtn")
  .addEventListener("touchstart", (event) => {
    startFirstMove(11, event);
  });
document
  .getElementById("firstBackwardBtn")
  .addEventListener("touchend", stopFirstMove);

document
  .getElementById("firstForwardBtn")
  .addEventListener("mousedown", (event) => {
    startFirstMove(10, event);
  });
document
  .getElementById("firstForwardBtn")
  .addEventListener("mouseup", stopFirstMove);
document
  .getElementById("firstForwardBtn")
  .addEventListener("mouseleave", stopFirstMove);
document
  .getElementById("firstForwardBtn")
  .addEventListener("touchstart", (event) => {
    startFirstMove(10, event);
  });
document
  .getElementById("firstForwardBtn")
  .addEventListener("touchend", stopFirstMove);

document
  .getElementById("reset-btn")
  .addEventListener("click", resetFirstCalibration);

document
  .getElementById("firstCalibrationSaveBtn")
  .addEventListener("click", saveFirstCalibration);

document
  .getElementById("completedSetupBtn")
  .addEventListener("click", completeFirstCalibration);

document.getElementById("setup-logout").addEventListener("click", logout);

document.getElementById("toggle").addEventListener("click", toggleWindow);

document.getElementById("connectBtn").addEventListener("click", connect);

document
  .getElementById("add-schedule-btn")
  .addEventListener("click", openScheduleModal);

document
  .getElementById("addScheduleFloatingBtn")
  .addEventListener("click", openScheduleModal);

document.getElementById("changeNameBtn").addEventListener("click", () => {
  openModal("nameModal");
});

document
  .getElementById("resendVerificationBtn")
  .addEventListener("click", resendVerification);

document.getElementById("changePassBtn").addEventListener("click", () => {
  openModal("passwordModal");
});

document
  .getElementById("disconnectDeviceBtn")
  .addEventListener("click", disconnect);

document
  .getElementById("changeCalibrationBtn")
  .addEventListener("click", () => {
    openModal("calibrationModal");
  });

document
  .getElementById("connectFromSettingsBtn")
  .addEventListener("click", connectFromSettings);

document.getElementById("logoutSettingsBtn").addEventListener("click", logout);

document.getElementById("closeNameModal").addEventListener("click", () => {
  closeModal("nameModal");
});

document.getElementById("saveNameBtn").addEventListener("click", changeName);

document.getElementById("closePassModal").addEventListener("click", () => {
  closeModal("passwordModal");
});

document.getElementById("closePassBtn").addEventListener("click", () => {
  closeModal("passwordModal");
});

document
  .getElementById("savePasswordBtn")
  .addEventListener("click", changePassword);

// ===== Calibration modal =====
const calibrationCloseBtn = document.getElementById("calibrationCloseBtn");
calibrationCloseBtn.addEventListener("click", closeCalibrationModal);

const startCalibrationBtn = document.getElementById("startCalibrationBtn");
startCalibrationBtn.addEventListener("click", startCalibration);

const restartCalibrationBtn = document.getElementById("restartCalibrationBtn");
restartCalibrationBtn.addEventListener("click", restartCalibration);

const saveCalibrationBtn = document.getElementById("saveCalibrationBtn");
saveCalibrationBtn.addEventListener("click", saveCalibration);

// Move controls (mouse + touch)
const backwardBtn = document.getElementById("backwardBtn");
backwardBtn.addEventListener("mousedown", (event) => startMove(11, event));
backwardBtn.addEventListener("mouseup", stopMove);
backwardBtn.addEventListener("mouseleave", stopMove);
backwardBtn.addEventListener("touchstart", (event) => startMove(11, event), {
  passive: false,
});
backwardBtn.addEventListener("touchend", stopMove);

const forwardBtn = document.getElementById("forwardBtn");
forwardBtn.addEventListener("mousedown", (event) => startMove(10, event));
forwardBtn.addEventListener("mouseup", stopMove);
forwardBtn.addEventListener("mouseleave", stopMove);
forwardBtn.addEventListener("touchstart", (event) => startMove(10, event), {
  passive: false,
});
forwardBtn.addEventListener("touchend", stopMove);

// (optional but smart) If user scrolls/gestures during touch, stop the motor
forwardBtn.addEventListener("touchcancel", stopMove);
backwardBtn.addEventListener("touchcancel", stopMove);

// ===== Schedule modal =====
const scheduleCloseBtn = document.getElementById("scheduleCloseBtn");
scheduleCloseBtn.addEventListener("click", closeScheduleModal);

const scheduleCancelBtn = document.getElementById("scheduleCancelBtn");
scheduleCancelBtn.addEventListener("click", closeScheduleModal);

const saveScheduleBtn = document.getElementById("saveScheduleBtn");
saveScheduleBtn.addEventListener("click", saveSchedule);

// Action selection (delegation on the container)
const scheduleActionToggle = document.getElementById("scheduleActionToggle");
scheduleActionToggle.addEventListener("click", (e) => {
  const btn = e.target.closest(".action-btn");
  if (!btn) return;
  selectAction(btn.dataset.action);
});

// Days selection (delegation on the container)
const daysSelector = document.getElementById("daysSelector");
daysSelector.addEventListener("click", (e) => {
  const btn = e.target.closest(".day-btn");
  if (!btn) return;
  toggleDay(Number(btn.dataset.day));
});

// ===== Connection required modal =====
const connectionRequiredCloseBtn = document.getElementById(
  "connectionRequiredCloseBtn"
);
connectionRequiredCloseBtn.addEventListener("click", () =>
  closeModal("connectionRequiredModal")
);

const connectionRequiredCancelBtn = document.getElementById(
  "connectionRequiredCancelBtn"
);
connectionRequiredCancelBtn.addEventListener("click", () =>
  closeModal("connectionRequiredModal")
);

const connectFromModalBtn = document.getElementById("connectFromModalBtn");
connectFromModalBtn.addEventListener("click", connectFromModal);

// ============== DEVICE SETUP (First Time Pairing) ==============

async function setupDevice() {
  const btn = document.getElementById("setupBtn");
  const icon = document.getElementById("setupIcon");
  const title = document.getElementById("setupTitle");
  const description = document.getElementById("setupDescription");
  const steps = document.getElementById("setupSteps");
  const status = document.getElementById("setupStatus");

  status.classList.remove("show", "error", "info");

  btn.disabled = true;
  btn.innerHTML = '<i class="ph ph-spinner"></i> Scanning...';
  icon.classList.add("searching");
  title.textContent = "Searching for Device";
  description.textContent = "Looking for your Auris nearby...";
  steps.style.display = "none";

  try {
    // Step 1: Connect to BLE device
    await connectToDevice();
    const bleDeviceId = device.id;

    title.textContent = "Requesting Token";
    description.textContent = "Getting pairing token from server...";
    btn.innerHTML = '<i class="ph ph-spinner"></i> Requesting...';

    // Step 2: Get pair token from server
    const registerResponse = await fetch("/request-pair-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ deviceId: bleDeviceId }),
    });

    if (!registerResponse.ok) {
      const errorData = await registerResponse.json().catch(() => ({}));
      throw new Error(errorData.message || "Failed to get pair token");
    }

    const registerData = await registerResponse.json();
    const token = registerData.pair_token;

    if (!token) {
      throw new Error("No token received from server");
    }

    title.textContent = "Pairing Device";
    description.textContent = "Sending pairing token to Auris...";
    btn.innerHTML = '<i class="ph ph-spinner"></i> Pairing...';

    // Step 3: Send first-time pairing sequence to ESP32
    await authenticateFirstTime(token);

    // Step 4: Register device with backend (confirm pairing)
    title.textContent = "Confirming";
    description.textContent = "Confirming pairing with server...";

    const confirmResponse = await fetch("/confirm-pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ deviceId: bleDeviceId }),
    });

    if (!confirmResponse.ok) {
      console.warn("Failed to confirm pairing with server");
    }

    // Success!
    icon.classList.remove("searching");
    icon.classList.add("success");
    icon.innerHTML = '<i class="ph ph-check-circle"></i>';
    title.textContent = "Setup Complete!";
    description.textContent = "Your Auris is now linked to your account.";
    btn.classList.add("success");
    btn.innerHTML = '<i class="ph ph-check"></i> Device Paired';

    // Update user data
    userData.deviceId = bleDeviceId;
    deviceId = bleDeviceId;

    setTimeout(() => {
      showFirstCalibrationCard();
    }, 2000);
  } catch (err) {
    console.error("Setup error:", err);

    // Disconnect on error
    if (device?.gatt?.connected) {
      device.gatt.disconnect();
    }

    icon.classList.remove("searching");
    icon.innerHTML = '<i class="ph ph-bluetooth"></i>';
    title.textContent = "Connect Your Device";
    description.textContent =
      "Pair your Auris window opener to link it with your account.";
    steps.style.display = "block";
    btn.disabled = false;
    btn.classList.remove("success");
    btn.innerHTML = '<i class="ph ph-bluetooth"></i> Scan for Device';

    status.classList.add("show", "error");
    if (err.message.includes("User cancelled")) {
      status.querySelector("span").textContent =
        "Pairing was cancelled. Try again when ready.";
    } else if (err.message.includes("already registered")) {
      status.querySelector("span").textContent =
        "This device is already registered to another account.";
    } else if (err.message.includes("Authentication failed")) {
      status.querySelector("span").textContent =
        "Failed to authenticate with device. Please try again.";
    } else if (err.message.includes("token")) {
      status.querySelector("span").textContent =
        "Failed to get pairing token. Please try again.";
    } else {
      status.querySelector("span").textContent =
        "Could not connect to device. Please try again.";
    }
  }
}

// ============== NORMAL CONNECTION ==============
async function connect() {
  if (device?.gatt?.connected) {
    disconnect();
    return;
  }

  const btn = document.getElementById("connectBtn");
  btn.disabled = true;
  btn.innerHTML = '<i class="ph ph-spinner"></i> Connecting...';

  try {
    // Step 1: Connect BLE
    await connectToDevice();

    // Step 2: Check if we have a stored token
    if (!pairToken) {
      // No token stored - need to get from server or re-pair
      btn.innerHTML = '<i class="ph ph-spinner"></i> Getting token...';

      const tokenResponse = await fetch("/get-pair-token", {
        method: "GET",
        credentials: "include",
      });

      if (tokenResponse.ok) {
        const data = await tokenResponse.json();
        if (data.pair_token) {
          pairToken = data.pair_token;
          saveToken(pairToken);
        }
      }

      if (!pairToken) {
        throw new Error("No pair token available. Please re-pair the device.");
      }
    }

    // Step 3: Authenticate with ESP32
    btn.innerHTML = '<i class="ph ph-spinner"></i> Authenticating...';
    await authenticateNormal(pairToken);

    // Step 4: Read device state
    await readState();

    // Success!
    updateConnectionUI(true);
  } catch (err) {
    console.error("Connection error:", err);

    // Handle token mismatch - might need to re-pair
    if (err.message.includes("token mismatch")) {
      clearToken();
      alert(
        "Authentication failed. The device may have been reset. Please re-pair from Settings."
      );
    }

    if (device?.gatt?.connected) {
      device.gatt.disconnect();
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="ph ph-bluetooth"></i> Connect Device';
    isAuthenticated = false;
  }
}

async function connectToDevice() {
  if (device) {
    device.removeEventListener("gattserverdisconnected", handleDisconnect);
  }

  device = await navigator.bluetooth.requestDevice({
    filters: [{ name: DEVICE_NAME }],
    optionalServices: [SERVICE_UUID],
  });

  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(SERVICE_UUID);
  characteristic = await service.getCharacteristic(CHAR_UUID);

  device.addEventListener("gattserverdisconnected", handleDisconnect);
}

function disconnect() {
  if (device?.gatt?.connected) {
    device.gatt.disconnect();
  }
  updateConnectionUI(false);
}

function handleDisconnect() {
  isAuthenticated = false;
  updateConnectionUI(false);
}

function updateConnectionUI(connected) {
  isConnected = connected;

  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const connectBtn = document.getElementById("connectBtn");
  const toggle = document.getElementById("toggle");

  statusDot.className = "status-dot " + (connected ? "on" : "off");
  statusText.textContent = connected ? "Connected" : "Disconnected";

  connectBtn.disabled = false;
  if (connected) {
    connectBtn.innerHTML =
      '<i class="ph ph-bluetooth-connected"></i> Disconnect';
    connectBtn.classList.add("connected");
  } else {
    connectBtn.innerHTML = '<i class="ph ph-bluetooth"></i> Connect Device';
    connectBtn.classList.remove("connected");
    isAuthenticated = false;
  }

  toggle.classList.toggle("disabled", !connected || !isAuthenticated);

  if (!connected) {
    windowOpen = false;
    updateWindow();
  }

  updateSettingsVisibility();
}

// ============== UNPAIR DEVICE ==============
async function unpairDevice() {
  if (
    !confirm(
      "Are you sure you want to unpair this device? You will need to set it up again."
    )
  ) {
    return;
  }

  try {
    // If connected, send unpair command
    if (isConnected && isAuthenticated && pairToken) {
      await sendJSON({ unpair: true });
      await delay(500);
    }

    // Clear local token
    clearToken();

    // Tell server to unpair
    await fetch("/unpair-device", {
      method: "POST",
      credentials: "include",
    });

    // Disconnect
    if (device?.gatt?.connected) {
      device.gatt.disconnect();
    }

    // Reset state
    userData.deviceId = null;
    deviceId = null;
    isAuthenticated = false;

    alert("Device unpaired successfully.");
    showSetupCard();
  } catch (err) {
    console.error("Unpair error:", err);
    alert("Failed to unpair. Please try again.");
  }
}

// ============== READ STATE ==============
async function readState() {
  if (!characteristic) return;

  try {
    const value = await characteristic.readValue();

    windowOpen = value.getUint8(0) === 1;

    if (value.byteLength > 1) {
      isCalibrated = value.getUint8(1) === 1;
    }

    if (value.byteLength > 4) {
      isAuthenticated = value.getUint8(4) === 1;
    }

    updateWindow();
  } catch (e) {
    console.error("Read state error:", e);
  }
}

// ============== FIRST CALIBRATION ==============
function showCalibrationError(message) {
  const status = document.getElementById("firstCalibrationStatus");
  status.classList.add("show", "error");
  status.querySelector("span").textContent = message;
}

function hideCalibrationStatus() {
  const status = document.getElementById("firstCalibrationStatus");
  status.classList.remove("show", "error", "info");
}

async function startFirstCalibration() {
  const btn = document.getElementById("firstCalibrationStartBtn");
  hideCalibrationStatus();

  btn.disabled = true;

  // Should already be connected and authenticated from setup
  if (!characteristic || !device?.gatt?.connected) {
    btn.innerHTML = '<i class="ph ph-bluetooth"></i> Connecting...';
    try {
      await connectToDevice();

      // Re-authenticate if needed
      if (pairToken && !isAuthenticated) {
        await authenticateNormal(pairToken);
      }
    } catch (err) {
      btn.innerHTML = '<i class="ph ph-play"></i> Start Calibration';
      btn.disabled = false;
      showCalibrationError(
        "Could not connect to device. Make sure Auris is powered on and nearby."
      );
      return;
    }
  }

  btn.innerHTML = '<i class="ph ph-spinner"></i> Starting...';

  const success = await sendCommand(CMD.RESET_ENCODER);
  if (!success) {
    btn.innerHTML = '<i class="ph ph-play"></i> Start Calibration';
    btn.disabled = false;
    showCalibrationError("Failed to start calibration. Please try again.");
    return;
  }

  await delay(500);

  document.getElementById("firstCalibrationIntro").style.display = "none";
  document.getElementById("firstCalibrationControls").style.display = "block";

  btn.disabled = false;
  btn.innerHTML = '<i class="ph ph-play"></i> Start Calibration';
}

function startFirstMove(direction, event) {
  if (event) event.preventDefault();
  const btnId =
    direction === CMD.MOVE_FORWARD ? "firstForwardBtn" : "firstBackwardBtn";
  document.getElementById(btnId).classList.add("active");
  sendCommand(direction);
}

function stopFirstMove() {
  document.getElementById("firstForwardBtn").classList.remove("active");
  document.getElementById("firstBackwardBtn").classList.remove("active");
  sendCommand(CMD.STOP);
}

function resetFirstCalibration() {
  document.getElementById("firstCalibrationControls").style.display = "none";
  document.getElementById("firstCalibrationIntro").style.display = "block";
}

async function saveFirstCalibration() {
  const btn = document.getElementById("firstCalibrationSaveBtn");

  btn.innerHTML = '<i class="ph ph-spinner"></i> Saving...';
  btn.disabled = true;

  const success = await sendCommand(CMD.SAVE_CALIBRATION);

  if (!success) {
    btn.innerHTML = '<i class="ph ph-check"></i> Save';
    btn.disabled = false;
    return;
  }

  await delay(1000);
  await readState();

  document.getElementById("firstCalibrationControls").style.display = "none";
  document.getElementById("firstCalibrationSuccess").style.display = "block";

  btn.innerHTML = '<i class="ph ph-check"></i> Save';
  btn.disabled = false;
}

function completeFirstCalibration() {
  showAppCard();
  updateConnectionUI(true);
}

// ============== CALIBRATION MODAL ==============
async function startCalibration() {
  const btn = document.querySelector(".start-calibration-btn");

  btn.disabled = true;
  btn.innerHTML = '<i class="ph ph-spinner"></i> Starting...';

  const success = await sendCommand(CMD.RESET_ENCODER);

  if (success) {
    await delay(500);
    document.getElementById("calibrationInstructions").style.display = "none";
    document.getElementById("calibrationControls").style.display = "block";
  }

  btn.disabled = false;
  btn.innerHTML = '<i class="ph ph-play"></i> Start Calibration';
}

function restartCalibration() {
  document.getElementById("calibrationControls").style.display = "none";
  document.getElementById("calibrationInstructions").style.display = "block";
}

function closeCalibrationModal() {
  closeModal("calibrationModal");
  setTimeout(() => {
    document.getElementById("calibrationControls").style.display = "none";
    document.getElementById("calibrationInstructions").style.display = "block";
  }, 300);
}

function startMove(direction, event) {
  if (event) event.preventDefault();
  const btnId = direction === CMD.MOVE_FORWARD ? "forwardBtn" : "backwardBtn";
  document.getElementById(btnId).classList.add("active");
  sendCommand(direction);
}

function stopMove() {
  document.getElementById("forwardBtn").classList.remove("active");
  document.getElementById("backwardBtn").classList.remove("active");
  sendCommand(CMD.STOP);
}

async function saveCalibration() {
  const btn = document.getElementById("saveCalibrationBtn");
  const originalContent = btn.innerHTML;

  btn.innerHTML = '<i class="ph ph-spinner"></i> Saving...';
  btn.disabled = true;

  const success = await sendCommand(CMD.SAVE_CALIBRATION);

  if (success) {
    await delay(500);
    await readState();
    btn.innerHTML = '<i class="ph ph-check"></i> Saved!';

    setTimeout(() => {
      btn.innerHTML = originalContent;
      btn.disabled = false;
      closeCalibrationModal();
    }, 1000);
  } else {
    btn.innerHTML = originalContent;
    btn.disabled = false;
  }
}

// ============== WINDOW CONTROL ==============
function updateWindow() {
  const windowEl = document.getElementById("window");
  const slider = document.getElementById("slider");
  const windowState = document.getElementById("windowState");

  windowEl.classList.toggle("open", windowOpen);
  slider.classList.toggle("open", windowOpen);
  windowState.classList.toggle("open", windowOpen);
  windowState.textContent = windowOpen ? "Open" : "Closed";

  slider.innerHTML = `<span class="icon"><i class="ph ph-lock-simple${
    windowOpen ? "-open" : ""
  }"></i></span>`;
}

async function toggleWindow() {
  if (!characteristic || !isAuthenticated) return;

  windowOpen = !windowOpen;
  const success = await sendCommand(windowOpen ? CMD.OPEN : CMD.CLOSE);

  if (success) {
    updateWindow();
  } else {
    windowOpen = !windowOpen;
  }
}

// ============== AUTH & USER DATA ==============
async function loadUserData() {
  try {
    const response = await fetch("/api/user-data", {
      method: "GET",
      credentials: "include",
    });

    if (!response.ok) {
      const refreshResp = await fetch("/api/refresh", {
        method: "GET",
        credentials: "include",
      });

      if (refreshResp.ok) {
        const retryResponse = await fetch("/api/user-data", {
          method: "GET",
          credentials: "include",
        });
        if (retryResponse.ok) {
          userData = await retryResponse.json();
        } else {
          throw new Error("Not authenticated");
        }
      } else {
        await fetch("/api/refresh/logout");
        throw new Error("Not authenticated");
      }
    } else {
      userData = await response.json();
    }

    if (userData.isDeactivated) {
      showAuthCard();
      return;
    }

    if (userData.deviceId) {
      deviceId = userData.deviceId;
      isCalibrated = userData.isCalibrated || false;

      if (!isCalibrated) {
        showFirstCalibrationCard();
      } else {
        showAppCard();
      }
    } else {
      showSetupCard();
    }

    updateUserInfo();
    updateSettingsUI();
  } catch (e) {
    console.error("Auth error:", e);
    localStorage.clear();
    showAuthCard();
  }
}

function showAuthCard() {
  hideAllCards();
  document.getElementById("authCard").style.display = "block";
}

function showSetupCard() {
  hideAllCards();
  document.getElementById("setupCard").style.display = "block";

  if (userData?.email) {
    document.getElementById("setupUserEmail").textContent = userData.email;
  }
}

function showFirstCalibrationCard() {
  hideAllCards();
  document.getElementById("firstCalibrationCard").style.display = "block";

  if (userData?.email) {
    document.getElementById("firstCalibrationEmail").textContent =
      userData.email;
  }

  document.getElementById("firstCalibrationIntro").style.display = "block";
  document.getElementById("firstCalibrationControls").style.display = "none";
  document.getElementById("firstCalibrationSuccess").style.display = "none";
  hideCalibrationStatus();
}

function showAppCard() {
  hideAllCards();
  document.getElementById("appCard").style.display = "block";
}

function hideAllCards() {
  document.getElementById("loader").style.display = "none";
  document.getElementById("authCard").style.display = "none";
  document.getElementById("setupCard").style.display = "none";
  document.getElementById("firstCalibrationCard").style.display = "none";
  document.getElementById("appCard").style.display = "none";
}

function updateUserInfo() {
  if (!userData) return;

  const elements = {
    userAvatar: userData.name?.charAt(0).toUpperCase(),
    userName: userData.name,
  };

  Object.entries(elements).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el && value) el.textContent = value;
  });
}

function updateSettingsUI() {
  if (!userData) return;

  const nameEl = document.getElementById("settingsUserName");
  if (nameEl) nameEl.textContent = userData.name || "Not set";

  const emailEl = document.getElementById("settingsUserEmail");
  if (emailEl) emailEl.textContent = userData.email || "Not set";

  const badge = document.getElementById("verificationBadge");
  const icon = document.getElementById("emailVerificationIcon");
  const verificationItem = document.getElementById("verificationItem");

  if (userData.isEmailVerified) {
    badge.className = "verification-badge verified";
    badge.innerHTML = '<i class="ph ph-check-circle"></i><span>Verified</span>';
    icon.className = "settings-item-icon verified";
    verificationItem.style.display = "none";
  } else {
    badge.className = "verification-badge unverified";
    badge.innerHTML = '<i class="ph ph-warning"></i><span>Unverified</span>';
    icon.className = "settings-item-icon unverified";
    verificationItem.style.display = "flex";
  }
}

// ============== LOGOUT ==============
async function logout() {
  const btns = document.querySelectorAll(".logout-btn, .setup-logout");
  btns.forEach((btn) => {
    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-spinner"></i> Signing out...';
  });

  try {
    await fetch("/api/refresh/logout", { credentials: "include" });
  } catch (e) {
    console.error("Logout error:", e);
  }

  localStorage.clear();
  window.location.href = "/log-in";
}

// ============== TAB NAVIGATION ==============
function initTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchTab(btn.dataset.tab);
    });
  });
}

function switchTab(tabId) {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  });

  document.querySelectorAll(".tab-content").forEach((content) => {
    content.classList.remove("active");
  });

  document.getElementById(tabId + "Tab").classList.add("active");

  if (tabId === "settings") {
    updateSettingsVisibility();
  }
}

function updateSettingsVisibility() {
  const connected = document.getElementById("settingsConnected");
  const notConnected = document.getElementById("settingsNotConnected");

  if (isConnected && isAuthenticated) {
    connected.style.display = "block";
    notConnected.style.display = "none";
  } else {
    connected.style.display = "none";
    notConnected.style.display = "block";
  }
}

async function connectFromSettings() {
  await connect();
  updateSettingsVisibility();
}

// ============== MODAL FUNCTIONS ==============
function initModals() {
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        const modalId = overlay.id;
        if (modalId === "calibrationModal") {
          closeCalibrationModal();
        } else if (modalId === "scheduleModal") {
          closeScheduleModal();
        } else {
          closeModal(modalId);
        }
      }
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal-overlay.active").forEach((modal) => {
        if (modal.id === "calibrationModal") {
          closeCalibrationModal();
        } else if (modal.id === "scheduleModal") {
          closeScheduleModal();
        } else {
          closeModal(modal.id);
        }
      });
    }
  });
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;

  modal.classList.add("active");
  document.body.style.overflow = "hidden";

  const firstInput = modal.querySelector("input");
  if (firstInput) {
    setTimeout(() => firstInput.focus(), 100);
  }

  if (modalId === "nameModal" && userData) {
    document.getElementById("newNameInput").value = userData.name || "";
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;

  modal.classList.remove("active");
  document.body.style.overflow = "";
  resetModalForm(modalId);
}

function resetModalForm(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;

  modal.querySelectorAll("input").forEach((input) => {
    if (modalId !== "nameModal") {
      input.value = "";
    }
  });

  modal.querySelectorAll(".form-error, .form-success").forEach((el) => {
    el.classList.remove("show");
  });

  modal.querySelectorAll(".modal-btn.primary").forEach((btn) => {
    btn.disabled = false;
    if (modalId === "nameModal") {
      btn.innerHTML = '<i class="ph ph-check"></i> Save';
    } else if (modalId === "passwordModal") {
      btn.innerHTML = '<i class="ph ph-check"></i> Send';
    }
  });
}

function showFormError(errorId, message) {
  const errorEl = document.getElementById(errorId);
  if (errorEl) {
    errorEl.querySelector("span").textContent = message;
    errorEl.classList.add("show");
  }
}

function showFormSuccess(successId, message) {
  const successEl = document.getElementById(successId);
  if (successEl) {
    successEl.querySelector("span").textContent = message;
    successEl.classList.add("show");
  }
}

function hideFormMessages(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.querySelectorAll(".form-error, .form-success").forEach((el) => {
      el.classList.remove("show");
    });
  }
}

// ============== USER ACCOUNT FUNCTIONS ==============
async function changeName() {
  const nameInput = document.getElementById("newNameInput");
  const btn = document.getElementById("saveNameBtn");
  const newName = nameInput.value.trim();

  hideFormMessages("nameModal");

  if (!newName) {
    showFormError("nameError", "Please enter a name");
    return;
  }

  if (newName.length < 2) {
    showFormError("nameError", "Name must be at least 2 characters");
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="ph ph-spinner"></i> Saving...';

  try {
    const response = await fetch("/api/refresh/update-name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name: newName }),
    });

    if (!response.ok) {
      throw new Error("Failed to update name");
    }

    userData.name = newName;
    updateSettingsUI();
    updateUserInfo();

    showFormSuccess("nameSuccess", "Name updated successfully!");

    setTimeout(() => closeModal("nameModal"), 1500);
  } catch (error) {
    showFormError("nameError", "Failed to update name. Please try again.");
    btn.disabled = false;
    btn.innerHTML = '<i class="ph ph-check"></i> Save';
  }
}

async function changePassword() {
  const btn = document.getElementById("savePasswordBtn");

  hideFormMessages("passwordModal");

  btn.disabled = true;
  btn.innerHTML = '<i class="ph ph-spinner"></i> Sending...';

  try {
    const response = await fetch("/request-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email: userData.email }),
    });

    if (!response.ok) {
      throw new Error("Failed to send reset link");
    }

    showFormSuccess("passwordSuccess", "Password reset link sent!");

    setTimeout(() => closeModal("passwordModal"), 1500);
  } catch (error) {
    showFormError(
      "passwordError",
      "Failed to send link. Make sure your email is verified."
    );
    btn.disabled = false;
    btn.innerHTML = '<i class="ph ph-check"></i> Send';
  }
}

async function resendVerification() {
  const btn = document.getElementById("resendVerificationBtn");

  btn.disabled = true;
  btn.textContent = "Sending...";
  btn.classList.remove("success", "danger");

  try {
    const response = await fetch("/resend-verification", {
      method: "POST",
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error("Failed to send verification email");
    }

    btn.textContent = "Sent!";
    btn.classList.add("success");

    setTimeout(() => {
      btn.textContent = "Resend";
      btn.classList.remove("success");
      btn.disabled = false;
    }, 10000);
  } catch (error) {
    console.error("Resend verification error:", error);
    btn.textContent = "Failed";
    btn.classList.add("danger");

    setTimeout(() => {
      btn.textContent = "Resend";
      btn.classList.remove("danger");
      btn.disabled = false;
    }, 5000);
  }
}

// ============== SCHEDULE FUNCTIONS ==============
function loadSchedules() {
  const saved = localStorage.getItem("auris_schedules");
  if (saved) {
    schedules = JSON.parse(saved);
  }
  renderSchedules();
}

function saveSchedulesToStorage() {
  localStorage.setItem("auris_schedules", JSON.stringify(schedules));
}

function renderSchedules() {
  const emptyState = document.getElementById("scheduleEmptyState");
  const list = document.getElementById("scheduleList");
  const floatingBtn = document.getElementById("addScheduleFloatingBtn");

  if (schedules.length === 0) {
    emptyState.style.display = "block";
    list.style.display = "none";
    floatingBtn.style.display = "none";
  } else {
    emptyState.style.display = "none";
    list.style.display = "flex";
    floatingBtn.style.display = "flex";

    list.innerHTML = schedules
      .map((schedule) => createScheduleItemHTML(schedule))
      .join("");
  }
}

function createScheduleItemHTML(schedule) {
  const dayLabels = ["S", "M", "T", "W", "T", "F", "S"];
  const daysHTML = dayLabels
    .map(
      (label, index) =>
        `<span class="schedule-day-dot ${
          schedule.days.includes(index) ? "active" : ""
        }">${label}</span>`
    )
    .join("");

  const timeFormatted = formatTime(schedule.time);
  const actionIcon =
    schedule.action === "open" ? "arrow-square-out" : "arrow-square-in";

  return `
          <div class="schedule-item ${
            schedule.enabled ? "" : "disabled"
          }" data-id="${schedule.id}">
            <div class="schedule-item-icon ${schedule.action}">
              <i class="ph ph-${actionIcon}"></i>
            </div>
            <div class="schedule-item-info">
              <div class="schedule-item-time">${timeFormatted}</div>
              ${
                schedule.name
                  ? `<div class="schedule-item-name">${escapeHtml(
                      schedule.name
                    )}</div>`
                  : ""
              }
              <div class="schedule-item-days">${daysHTML}</div>
            </div>
            <div class="schedule-item-actions">
              <button class="schedule-toggle ${
                schedule.enabled ? "active" : ""
              }" onclick="toggleSchedule('${schedule.id}')">
                <span class="schedule-toggle-knob"></span>
              </button>
              <button class="schedule-edit-btn" onclick="editSchedule('${
                schedule.id
              }')">
                <i class="ph ph-pencil-simple"></i>
              </button>
              <button class="schedule-delete-btn" onclick="deleteSchedule('${
                schedule.id
              }')">
                <i class="ph ph-trash"></i>
              </button>
            </div>
          </div>
        `;
}

function formatTime(time24) {
  const [hours, minutes] = time24.split(":");
  const h = parseInt(hours);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${minutes} ${ampm}`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function selectAction(action) {
  selectedAction = action;
  document.querySelectorAll(".action-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.action === action);
  });
}

function toggleDay(day) {
  const index = selectedDays.indexOf(day);
  if (index > -1) {
    selectedDays.splice(index, 1);
  } else {
    selectedDays.push(day);
  }
  selectedDays.sort((a, b) => a - b);

  document.querySelectorAll(".day-btn").forEach((btn) => {
    btn.classList.toggle(
      "active",
      selectedDays.includes(parseInt(btn.dataset.day))
    );
  });

  updateDaysHint();
}

function updateDaysHint() {
  const hint = document.getElementById("daysHint");

  if (selectedDays.length === 0) {
    hint.textContent = "Select at least one day";
    hint.style.color = "#ff6b81";
  } else if (selectedDays.length === 7) {
    hint.textContent = "Every day";
    hint.style.color = "";
  } else if (arraysEqual(selectedDays, [1, 2, 3, 4, 5])) {
    hint.textContent = "Weekdays";
    hint.style.color = "";
  } else if (arraysEqual(selectedDays, [0, 6])) {
    hint.textContent = "Weekends";
    hint.style.color = "";
  } else {
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    hint.textContent = selectedDays.map((d) => dayNames[d]).join(", ");
    hint.style.color = "";
  }
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((val, i) => val === b[i]);
}

function openScheduleModal() {
  if (isConnected && isAuthenticated) {
    resetScheduleModal();
    document.getElementById("scheduleModalTitle").textContent = "New Schedule";
    openModal("scheduleModal");
  } else {
    openModal("connectionRequiredModal");
  }
}

function connectFromModal() {
  closeModal("connectionRequiredModal");
  setTimeout(() => {
    connect();
  }, 200);
}

function closeScheduleModal() {
  closeModal("scheduleModal");
  editingScheduleId = null;
}

function resetScheduleModal() {
  document.getElementById("scheduleNameInput").value = "";
  document.getElementById("scheduleTimeInput").value = "08:00";

  selectedAction = "open";
  selectedDays = [1, 2, 3, 4, 5];

  document.querySelectorAll(".action-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.action === "open");
  });

  document.querySelectorAll(".day-btn").forEach((btn) => {
    const day = parseInt(btn.dataset.day);
    btn.classList.toggle("active", selectedDays.includes(day));
  });

  updateDaysHint();

  const error = document.getElementById("scheduleError");
  error.classList.remove("show");
}

function saveSchedule() {
  const name = document.getElementById("scheduleNameInput").value.trim();
  const time = document.getElementById("scheduleTimeInput").value;
  const errorEl = document.getElementById("scheduleError");

  if (selectedDays.length === 0) {
    errorEl.querySelector("span").textContent =
      "Please select at least one day";
    errorEl.classList.add("show");
    return;
  }

  if (!time) {
    errorEl.querySelector("span").textContent = "Please select a time";
    errorEl.classList.add("show");
    return;
  }

  errorEl.classList.remove("show");

  const scheduleData = {
    id: editingScheduleId || generateId(),
    name: name,
    action: selectedAction,
    time: time,
    days: [...selectedDays],
    enabled: true,
  };

  if (editingScheduleId) {
    const index = schedules.findIndex((s) => s.id === editingScheduleId);
    if (index > -1) {
      scheduleData.enabled = schedules[index].enabled;
      schedules[index] = scheduleData;
    }
  } else {
    schedules.push(scheduleData);
  }

  saveSchedulesToStorage();
  renderSchedules();
  closeScheduleModal();
  syncSchedulesWithDevice();
}

function editSchedule(id) {
  if (!isConnected || !isAuthenticated) {
    openModal("connectionRequiredModal");
    return;
  }

  const schedule = schedules.find((s) => s.id === id);
  if (!schedule) return;

  editingScheduleId = id;
  document.getElementById("scheduleModalTitle").textContent = "Edit Schedule";
  document.getElementById("scheduleNameInput").value = schedule.name || "";
  document.getElementById("scheduleTimeInput").value = schedule.time;

  selectedAction = schedule.action;
  selectedDays = [...schedule.days];

  document.querySelectorAll(".action-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.action === selectedAction);
  });

  document.querySelectorAll(".day-btn").forEach((btn) => {
    const day = parseInt(btn.dataset.day);
    btn.classList.toggle("active", selectedDays.includes(day));
  });

  updateDaysHint();
  openModal("scheduleModal");
}

function deleteSchedule(id) {
  if (!isConnected || !isAuthenticated) {
    openModal("connectionRequiredModal");
    return;
  }

  if (!confirm("Delete this schedule?")) return;

  schedules = schedules.filter((s) => s.id !== id);
  saveSchedulesToStorage();
  renderSchedules();
  syncSchedulesWithDevice();
}

function toggleSchedule(id) {
  if (!isConnected || !isAuthenticated) {
    openModal("connectionRequiredModal");
    return;
  }

  const schedule = schedules.find((s) => s.id === id);
  if (!schedule) return;

  schedule.enabled = !schedule.enabled;
  saveSchedulesToStorage();
  renderSchedules();
  syncSchedulesWithDevice();
}

function generateId() {
  return (
    "sch_" + Date.now().toString(36) + Math.random().toString(36).substr(2, 5)
  );
}

async function syncSchedulesWithDevice() {
  console.log("Syncing schedules:", schedules);
  // TODO: Send schedules to your backend or device
}

// ============== UTILITY FUNCTIONS ==============
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============== BLE SUPPORT CHECK ==============
if (!navigator.bluetooth) {
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".connect-btn, .setup-btn").forEach((btn) => {
      btn.disabled = true;
      btn.innerHTML = '<i class="ph ph-warning"></i> BLE Not Supported';
    });

    const status = document.getElementById("setupStatus");
    if (status) {
      status.classList.add("show", "error");
      status.querySelector("span").textContent =
        "Web Bluetooth is not supported in this browser. Please use Chrome, Edge, or Opera on a desktop or Android device.";
    }
  });
}
