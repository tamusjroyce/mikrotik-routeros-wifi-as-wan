import { initialScript, undoScript } from "./default-scripts.js";
import { normalizeVariables, parseScriptVariables, updateScriptVariables } from "./script-vars.js";

const defaultRouterFile = "enable-wifi-as-wan.rsc";
const undoRouterFile = "undo-wifi-as-wan.rsc";
const routerProfileStorageKey = "wifi-as-wan-router-profile-v1";
const scriptStorageKey = "wifi-as-wan-script-v1";

const form = document.querySelector("#configForm");
const statusLine = document.querySelector("#statusLine");
const detailOutput = document.querySelector("#detailOutput");
const controlsTab = document.querySelector("#controlsTab");
const scriptTab = document.querySelector("#scriptTab");
const showControlsTab = document.querySelector("#showControlsTab");
const showScriptTab = document.querySelector("#showScriptTab");
const scriptEditor = document.querySelector("#scriptEditor");
const scriptUrl = document.querySelector("#scriptUrl");
const saveDialog = document.querySelector("#saveDialog");
let lastLoadedScript = "";

const fields = {
  routerReachable: document.querySelector("#routerReachable"),
  internetReachable: document.querySelector("#internetReachable"),
  activeWan: document.querySelector("#activeWan"),
  scriptUploaded: document.querySelector("#scriptUploaded"),
  rxRate: document.querySelector("#rxRate"),
  txRate: document.querySelector("#txRate"),
  trafficRate: document.querySelector("#trafficRate"),
  signalLevel: document.querySelector("#signalLevel"),
  connectionPath: document.querySelector("#connectionPath"),
};
const bandwidthNote = document.querySelector("#bandwidthNote");

await loadConfig();
await refreshStatus();
setInterval(refreshStatus, 45_000);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./service-worker.js").catch(() => undefined);
}

document.querySelector("#refreshStatus").addEventListener("click", runAction(refreshStatus));
document.querySelector("#saveConfig").addEventListener("click", runAction(saveConfig));
document.querySelector("#installDefaults").addEventListener("click", runAction(installDefaults));
document.querySelector("#applyConfig").addEventListener("click", runAction(applyConfig));
document.querySelector("#undoWifiAsWan").addEventListener("click", runAction(undoWifiAsWan));
showControlsTab.addEventListener("click", () => showTab("controls"));
showScriptTab.addEventListener("click", async () => {
  showTab("script");
  if (!scriptEditor.value.trim()) await loadScriptEditor();
});
document.querySelector("#backToControls").addEventListener("click", () => showTab("controls"));
document.querySelector("#loadScript").addEventListener(
  "click",
  runAction(() => loadScriptEditor(true)),
);
document.querySelector("#reloadInitialScript").addEventListener(
  "click",
  runAction(reloadInitialScript),
);
document.querySelector("#applyScriptChanges").addEventListener(
  "click",
  runAction(applyScriptChanges),
);
document.querySelector("#saveChanges").addEventListener("click", runAction(saveChanges));
document.querySelector("#saveToFilesystem").addEventListener("click", runAction(saveToFilesystem));
document.querySelector("#saveToUrl").addEventListener("click", async () => {
  try {
    await postScriptToUrl();
    closeSaveDialog();
  } catch (error) {
    handleActionError(error);
  }
});
document.querySelector("#downloadScript").addEventListener("click", () => {
  downloadScript();
  closeSaveDialog();
});
document.querySelector("#loadScriptUrl").addEventListener("click", runAction(loadScriptFromUrl));
document.querySelector("#postScriptUrl").addEventListener("click", runAction(postScriptToUrl));
document.querySelector("#scriptFileInput").addEventListener(
  "change",
  runAction(loadScriptFromFile),
);

async function loadConfig() {
  setStatus("Loading configuration...");
  const routerProfile = readStoredRouterProfile();
  form.url.value = routerProfile.url;
  form.username.value = routerProfile.username;
  form.scriptFile.value = routerProfile.scriptFile;
  hydrateFormFromScript(readStoredScript());
  setStatus("Configuration loaded from this device.");
}

function showTab(tabName) {
  const scriptActive = tabName === "script";
  controlsTab.classList.toggle("active", !scriptActive);
  scriptTab.classList.toggle("active", scriptActive);
  showControlsTab.classList.toggle("active", !scriptActive);
  showScriptTab.classList.toggle("active", scriptActive);
}

async function loadScriptEditor(confirmOverwrite = false) {
  if (confirmOverwrite && hasScriptChanges() && !confirmDiscardChanges()) return;
  setStatus("Loading saved script...");
  const script = readStoredScript();
  scriptEditor.value = script;
  lastLoadedScript = script;
  setStatus("Saved script loaded.");
}

async function reloadInitialScript() {
  if (hasScriptChanges() && !confirmDiscardChanges()) return;
  setStatus("Loading initial script...");
  scriptEditor.value = initialScript;
  setStatus("Initial script loaded. Save to keep these changes.");
}

async function saveScriptEditor() {
  setStatus("Saving script on this device...");
  const script = normalizeScript(scriptEditor.value || initialScript);
  writeStoredScript(script);
  scriptEditor.value = script;
  lastLoadedScript = script;
  hydrateFormFromScript(script);
  setStatus("Script saved on this device.");
}

async function applyScriptChanges() {
  await saveScriptEditor();
  setStatus("Applying script changes...");
  await uploadCurrentScript();
}

async function saveChanges() {
  if (typeof saveDialog.showModal === "function") {
    saveDialog.showModal();
    return;
  }

  await saveToFilesystem();
}

async function saveToFilesystem() {
  if ("showSaveFilePicker" in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: "enable-wifi-as-wan.rsc",
        types: [{
          description: "RouterOS script",
          accept: { "text/plain": [".rsc", ".txt"] },
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(scriptEditor.value);
      await writable.close();
      setStatus("Script saved to filesystem.");
      closeSaveDialog();
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }

  downloadScript();
  closeSaveDialog();
}

function closeSaveDialog() {
  if (saveDialog.open) saveDialog.close();
}

function downloadScript() {
  const blob = new Blob([scriptEditor.value], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "enable-wifi-as-wan.rsc";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus("Script downloaded.");
}

async function loadScriptFromUrl() {
  if (hasScriptChanges() && !confirmDiscardChanges()) return;
  const url = scriptUrl.value.trim();
  if (!url) {
    setStatus("Enter a script URL first.");
    return;
  }

  setStatus("Loading script URL...");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Load URL failed: ${response.status}`);
  }
  const content = normalizeScript(await response.text());
  writeStoredScript(content);
  scriptEditor.value = content;
  lastLoadedScript = content;
  hydrateFormFromScript(content);
  setStatus("Script URL loaded and saved on this device.");
}

async function postScriptToUrl() {
  const url = scriptUrl.value.trim();
  if (!url) {
    setStatus("Enter a script URL first.");
    return;
  }

  setStatus("Posting script to URL...");
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    body: scriptEditor.value,
  });
  if (!response.ok) throw new Error(`Post URL failed: ${response.status}`);
  setStatus(`Script posted to URL (${response.status}).`);
}

async function loadScriptFromFile(event) {
  const [file] = event.target.files ?? [];
  if (!file) return;
  if (hasScriptChanges() && !confirmDiscardChanges()) {
    event.target.value = "";
    return;
  }
  scriptEditor.value = await file.text();
  lastLoadedScript = scriptEditor.value;
  setStatus(`Loaded ${file.name}. Save to update the local script.`);
  event.target.value = "";
}

function hasScriptChanges() {
  return scriptEditor.value !== lastLoadedScript;
}

function confirmDiscardChanges() {
  return globalThis.confirm("Overwrite unsaved script changes?");
}

async function saveConfig() {
  setStatus("Saving variables...");
  writeStoredRouterProfile();
  const variables = normalizeVariables(readVariables());
  const updatedScript = updateScriptVariables(currentScriptContent(), variables);
  writeStoredScript(updatedScript);
  scriptEditor.value = updatedScript;
  lastLoadedScript = updatedScript;
  hydrateFormFromScript(updatedScript);
  setStatus("Variables saved on this device.");
}

async function applyConfig() {
  await saveConfig();
  setStatus("Uploading and applying script...");
  await uploadCurrentScript();
}

async function installDefaults() {
  setStatus("Uploading default script...");
  await uploadCurrentScript();
}

async function undoWifiAsWan() {
  if (!globalThis.confirm("Restore WiFi radios to AP mode and remove WiFi-as-WAN settings?")) {
    return;
  }

  writeStoredRouterProfile();
  try {
    setStatus("Uploading and applying undo script directly on the router...");
    await uploadScriptToRouter(undoScript, undoRouterFile);
    await importRouterScript(undoRouterFile);
    setStatus(`Uploaded and imported ${undoRouterFile}`);
    await refreshStatus();
  } catch (directError) {
    console.debug("Direct RouterOS undo failed; trying backend fallback", directError);
    setStatus("Direct router undo failed; trying backend fallback...");
    const result = await invokeBackend("undo", {
      ...readRouterSettings(),
      scriptFileUndo: undoRouterFile,
    });
    setStatus(`${result.message} via backend fallback.`);
    await refreshStatus();
  }
}

async function uploadCurrentScript() {
  writeStoredRouterProfile();
  const scriptFile = form.scriptFile.value.trim() || defaultRouterFile;
  const script = currentScriptContent();
  try {
    setStatus(`Uploading ${scriptFile} directly to RouterOS...`);
    await uploadScriptToRouter(script, scriptFile);
    await importRouterScript(scriptFile);
    setStatus(`Uploaded and imported ${scriptFile}`);
    await refreshStatus();
  } catch (directError) {
    console.debug("Direct RouterOS apply failed; trying backend fallback", directError);
    setStatus("Direct router upload failed; trying backend fallback...");
    const result = await invokeBackend("apply", {
      ...readRouterSettings(),
      scriptFile,
      content: script,
    });
    setStatus(`${result.message} via backend fallback.`);
    await refreshStatus();
  }
}

async function refreshStatus() {
  writeStoredRouterProfile();
  try {
    const directStatus = await getDirectStatus();
    renderStatus({ ...directStatus, connectionPath: "direct" });
  } catch (error) {
    console.debug("Direct RouterOS status failed; trying backend fallback", error);
    try {
      const backendStatus = await invokeBackend("status", readRouterSettings());
      renderStatus({ ...backendStatus, connectionPath: "backend" });
    } catch (backendError) {
      renderStatus({
        reachable: false,
        internetReachable: false,
        activeWanInterface: undefined,
        scriptUploaded: false,
        bandwidth: {},
        error: explainRouterError(backendError ?? error),
        connectionPath: "unavailable",
      });
    }
  }
}

async function getDirectStatus() {
  const [files, wifi, registrations, dhcpClients, routes, schedulers] = await Promise.all([
    routerRestGet("/rest/file"),
    routerRestGet("/rest/interface/wifi"),
    routerRestGet("/rest/interface/wifi/registration-table"),
    routerRestGet("/rest/ip/dhcp-client"),
    routerRestGet("/rest/ip/route"),
    routerRestGet("/rest/system/scheduler"),
  ]);

  const activeRoute = routes.find((route) =>
    route?.["dst-address"] === "0.0.0.0/0" && route?.inactive === "false"
  );
  const activeWanInterface = activeRoute?.["vrf-interface"] || activeRoute?.gateway || undefined;
  const scriptUploaded = files.some((file) => file?.name === form.scriptFile.value);
  const schedulerInstalled = schedulers.some((scheduler) =>
    String(scheduler?.name ?? "").includes("wifi-as-wan")
  );
  const internetReachable = await directPingAny(splitCsv(form.internetCheckTargets.value));

  return {
    reachable: true,
    internetReachable,
    activeWanInterface,
    scriptUploaded,
    schedulerInstalled,
    bandwidth: buildDirectBandwidth(activeWanInterface, registrations),
    wifi,
    registrations,
    dhcpClients,
    routes,
  };
}

async function directPingAny(targets) {
  for (const target of targets.length ? targets : ["1.1.1.1", "8.8.8.8"]) {
    try {
      const result = await routerRestPost("/rest/ping", { address: target, count: "2" });
      const rows = Array.isArray(result)
        ? result
        : Array.isArray(result?.value)
        ? result.value
        : [result];
      const received = rows.reduce((total, row) => total + Number(row?.received ?? 0), 0);
      if (received > 0) return true;
    } catch {
      // Try next target.
    }
  }

  return false;
}

async function routerRestGet(path) {
  return await routerRest(path, { method: "GET" });
}

async function routerRestPost(path, body) {
  return await routerRest(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function routerRest(path, init) {
  const response = await fetch(new URL(path, form.url.value), {
    ...init,
    headers: {
      "Authorization": `Basic ${btoa(`${form.username.value}:${form.password.value}`)}`,
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) throw new Error(`Direct RouterOS ${path} failed: ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

async function uploadScriptToRouter(scriptContent, fileName) {
  const existingFile = await findRouterFile(fileName);

  if (existingFile?.[".id"]) {
    await routerRestPatch(`/rest/file/${existingFile[".id"]}`, {
      contents: normalizeScript(scriptContent),
    });
    return;
  }

  try {
    await routerRestPut("/rest/file", {
      name: fileName,
      type: "file",
      contents: normalizeScript(scriptContent),
    });
  } catch (error) {
    await routerRestPut("/rest/file", { name: fileName, type: "file" });
    const createdFile = await findRouterFile(fileName);
    if (!createdFile?.[".id"]) {
      throw error;
    }
    await routerRestPatch(`/rest/file/${createdFile[".id"]}`, {
      contents: normalizeScript(scriptContent),
    });
  }
}

async function findRouterFile(fileName) {
  const files = await routerRestPost("/rest/file/print", {
    ".proplist": [".id", "name"],
  });
  return files.find((file) => String(file?.name ?? "") === fileName);
}

async function importRouterScript(fileName) {
  await routerRestPost("/rest/import", { "file-name": fileName });
}

async function routerRestPut(path, body) {
  return await routerRest(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function routerRestPatch(path, body) {
  return await routerRest(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function buildDirectBandwidth(activeWanInterface, registrations) {
  const activeRegistration = registrations.find((registration) =>
    registration?.interface === activeWanInterface
  );
  return {
    activeInterface: activeWanInterface,
    rxBitsPerSecond: numberOrUndefined(activeRegistration?.["rx-bits-per-second"]),
    txBitsPerSecond: numberOrUndefined(activeRegistration?.["tx-bits-per-second"]),
    rxRate: numberOrUndefined(activeRegistration?.["rx-rate"]),
    txRate: numberOrUndefined(activeRegistration?.["tx-rate"]),
    signal: activeRegistration?.signal,
    note:
      "Direct browser RouterOS status. RouterOS device-mode blocks active bandwidth-test, so these values are live WiFi link counters.",
  };
}

function readVariables() {
  return {
    ssid: form.ssid.value,
    wifiPassword: form.wifiPassword.value,
    wifiInterfaces: splitCsv(form.wifiInterfaces.value),
    backupWifiInterface: form.backupWifiInterface.value,
    useWifi2Backup: form.useWifi2Backup.checked,
    natComment: form.natComment.value,
    dhcpCommentPrefix: "wifi-as-wan dhcp client",
    internetCheckTargets: splitCsv(form.internetCheckTargets.value),
  };
}

function renderStatus(status) {
  fields.routerReachable.textContent = status.reachable ? "Reachable" : "Offline";
  fields.internetReachable.textContent = status.internetReachable ? "Online" : "No internet";
  fields.activeWan.textContent = status.activeWanInterface || "None";
  fields.scriptUploaded.textContent = status.scriptUploaded ? "Uploaded" : "Missing";
  document.querySelector("#installDefaults").textContent = status.scriptUploaded
    ? "Overwrite with defaults"
    : "Install defaults";
  fields.rxRate.textContent = formatBits(status.bandwidth?.rxRate);
  fields.txRate.textContent = formatBits(status.bandwidth?.txRate);
  fields.trafficRate.textContent = `${formatBits(status.bandwidth?.rxBitsPerSecond)} ↓ / ${
    formatBits(status.bandwidth?.txBitsPerSecond)
  } ↑`;
  fields.signalLevel.textContent = status.bandwidth?.signal || "Unknown";
  fields.connectionPath.textContent = status.connectionPath === "direct"
    ? "Direct"
    : status.connectionPath === "backend"
    ? "Backend"
    : "Unavailable";
  bandwidthNote.textContent = status.bandwidth?.note || "No bandwidth detail available.";
  detailOutput.textContent = JSON.stringify(status, null, 2);
  setStatus(status.error ? `Status error: ${status.error}` : "Status refreshed.");
}

function formatBits(value) {
  if (!Number.isFinite(value)) return "Unknown";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} Gbps`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} Mbps`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} Kbps`;
  return `${value} bps`;
}

function splitCsv(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function numberOrUndefined(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function setStatus(message) {
  statusLine.textContent = message;
}

async function invokeBackend(action, payload) {
  if (typeof globalThis.__routerBackendInvoke === "function") {
    return await globalThis.__routerBackendInvoke(action, payload);
  }

  if (globalThis.AndroidRouterBackend?.invoke) {
    return await new Promise((resolve, reject) => {
      const callbackId = `android-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      globalThis.__routerBackendResolve ??= (id, result) => {
        const callback = globalThis.__routerBackendCallbacks?.[id];
        if (!callback) return;
        callback.resolve(result);
        delete globalThis.__routerBackendCallbacks[id];
      };
      globalThis.__routerBackendReject ??= (id, message) => {
        const callback = globalThis.__routerBackendCallbacks?.[id];
        if (!callback) return;
        callback.reject(new Error(String(message)));
        delete globalThis.__routerBackendCallbacks[id];
      };
      globalThis.__routerBackendCallbacks ??= {};
      globalThis.__routerBackendCallbacks[callbackId] = { resolve, reject };
      globalThis.AndroidRouterBackend.invoke(action, JSON.stringify(payload), callbackId);
    });
  }

  const response = await fetch(`/api/router/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error ?? `Backend ${action} failed: ${response.status}`);
  }

  return result;
}

function runAction(action) {
  return (...args) => Promise.resolve(action(...args)).catch(handleActionError);
}

function handleActionError(error) {
  setStatus(`Error: ${explainRouterError(error)}`);
}

function currentScriptContent() {
  return normalizeScript(scriptEditor.value || readStoredScript());
}

function readStoredRouterProfile() {
  const stored = safeParseStorage(routerProfileStorageKey);
  return {
    url: stored?.url || inferDefaultRouterUrl(),
    username: stored?.username || "admin",
    scriptFile: stored?.scriptFile || defaultRouterFile,
  };
}

function writeStoredRouterProfile() {
  localStorage.setItem(
    routerProfileStorageKey,
    JSON.stringify({
      url: form.url.value.trim() || inferDefaultRouterUrl(),
      username: form.username.value.trim() || "admin",
      scriptFile: form.scriptFile.value.trim() || defaultRouterFile,
    }),
  );
}

function readStoredScript() {
  return normalizeScript(localStorage.getItem(scriptStorageKey) || initialScript);
}

function writeStoredScript(script) {
  localStorage.setItem(scriptStorageKey, normalizeScript(script));
}

function hydrateFormFromScript(script) {
  const variables = parseScriptVariables(script);
  form.ssid.value = variables.ssid;
  form.wifiPassword.value = variables.wifiPassword;
  form.wifiInterfaces.value = variables.wifiInterfaces.join(",");
  form.backupWifiInterface.value = variables.backupWifiInterface;
  form.useWifi2Backup.checked = variables.useWifi2Backup;
  form.natComment.value = variables.natComment;
  form.internetCheckTargets.value = variables.internetCheckTargets.join(",");
  if (!scriptEditor.value.trim()) {
    scriptEditor.value = script;
  }
  lastLoadedScript = script;
}

function safeParseStorage(key) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function normalizeScript(script) {
  return String(script ?? "").replaceAll("\r\n", "\n");
}

function inferDefaultRouterUrl() {
  const { protocol, hostname, origin } = window.location;
  const isPrivateIpv4 = /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
  const looksLikeRouterOrigin = (protocol === "http:" || protocol === "https:") &&
    (isPrivateIpv4 || hostname.endsWith(".local"));

  return looksLikeRouterOrigin ? origin : "http://192.168.88.1";
}

function explainRouterError(error) {
  const baseMessage = error instanceof Error ? error.message : String(error);
  const routerUrl = form.url.value.trim();

  if (window.isSecureContext && routerUrl.startsWith("http://")) {
    return `${baseMessage}. Installed PWAs cannot call plain HTTP router endpoints; use RouterOS HTTPS for direct access.`;
  }

  return baseMessage;
}

function readRouterSettings() {
  return {
    url: form.url.value.trim(),
    username: form.username.value.trim(),
    password: form.password.value,
    scriptFile: form.scriptFile.value.trim() || defaultRouterFile,
  };
}
