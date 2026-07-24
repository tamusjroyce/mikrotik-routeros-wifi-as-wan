const editableKeys = [
  "ssid",
  "wifiPassword",
  "wifiInterfaces",
  "backupWifiInterface",
  "useWifi2Backup",
  "natComment",
  "dhcpCommentPrefix",
  "internetCheckTargets",
];

export const scriptVariableDefaults = {
  ssid: "LONG_PING_IS_LONG",
  wifiPassword: "pandaexpress",
  wifiInterfaces: ["wifi1", "wifi2"],
  backupWifiInterface: "wifi2",
  useWifi2Backup: false,
  natComment: "wifi-as-wan masquerade",
  dhcpCommentPrefix: "wifi-as-wan dhcp client",
  internetCheckTargets: ["1.1.1.1", "8.8.8.8"],
};

export function parseScriptVariables(script) {
  const variables = { ...scriptVariableDefaults };

  for (const key of editableKeys) {
    const match = script.match(new RegExp(`^:local\\s+${key}\\s+(.+)$`, "m"));
    if (!match) {
      continue;
    }

    const rawValue = match[1].trim();
    variables[key] = parseRouterValue(rawValue);
  }

  return variables;
}

export function updateScriptVariables(script, variables) {
  let updatedScript = script;

  for (const key of editableKeys) {
    const replacement = `:local ${key} ${formatRouterValue(variables[key])}`;
    const pattern = new RegExp(`^:local\\s+${key}\\s+.+$`, "m");

    if (pattern.test(updatedScript)) {
      updatedScript = updatedScript.replace(pattern, replacement);
    } else {
      updatedScript = `${replacement}\n${updatedScript}`;
    }
  }

  return updatedScript;
}

export function normalizeVariables(input) {
  return {
    ssid: normalizeString(input.ssid, scriptVariableDefaults.ssid),
    wifiPassword: normalizeString(input.wifiPassword, scriptVariableDefaults.wifiPassword),
    wifiInterfaces: normalizeStringArray(
      input.wifiInterfaces,
      scriptVariableDefaults.wifiInterfaces,
    ),
    backupWifiInterface: normalizeString(
      input.backupWifiInterface,
      scriptVariableDefaults.backupWifiInterface,
    ),
    useWifi2Backup: input.useWifi2Backup === true,
    natComment: normalizeString(input.natComment, scriptVariableDefaults.natComment),
    dhcpCommentPrefix: normalizeString(
      input.dhcpCommentPrefix,
      scriptVariableDefaults.dhcpCommentPrefix,
    ),
    internetCheckTargets: normalizeStringArray(
      input.internetCheckTargets,
      scriptVariableDefaults.internetCheckTargets,
    ),
  };
}

function parseRouterValue(rawValue) {
  if (rawValue === "true") {
    return true;
  }

  if (rawValue === "false") {
    return false;
  }

  if (rawValue.startsWith("{") && rawValue.endsWith("}")) {
    return rawValue.slice(1, -1).split(";").map((item) => parseRouterString(item.trim()))
      .filter(Boolean);
  }

  return parseRouterString(rawValue);
}

function formatRouterValue(value) {
  if (Array.isArray(value)) {
    return `{${value.map(formatRouterString).join(";")}}`;
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return formatRouterString(value);
}

function parseRouterString(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) {
    return trimmed;
  }

  return trimmed.slice(1, -1)
    .replaceAll('\\"', '"')
    .replaceAll("\\$", "$")
    .replaceAll("\\\\", "\\");
}

function formatRouterString(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("$", "\\$")}"`;
}

function normalizeString(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeStringArray(value, fallback) {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const normalized = value.map((item) => String(item).trim()).filter(Boolean);
  return normalized.length ? normalized : [...fallback];
}
