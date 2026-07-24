import type { ScriptVariables } from "./types.ts";

const editableKeys = [
  "ssid",
  "wifiPassword",
  "wifiInterfaces",
  "backupWifiInterface",
  "useWifi2Backup",
  "natComment",
  "dhcpCommentPrefix",
  "internetCheckTargets",
] as const;

type EditableKey = typeof editableKeys[number];

const defaults: ScriptVariables = {
  ssid: "LONG_PING_IS_LONG",
  wifiPassword: "pandaexpress",
  wifiInterfaces: ["wifi1", "wifi2"],
  backupWifiInterface: "wifi2",
  useWifi2Backup: false,
  natComment: "wifi-as-wan masquerade",
  dhcpCommentPrefix: "wifi-as-wan dhcp client",
  internetCheckTargets: ["1.1.1.1", "8.8.8.8"],
};

export function parseScriptVariables(script: string): ScriptVariables {
  const variables: ScriptVariables = { ...defaults };

  for (const key of editableKeys) {
    const match = script.match(new RegExp(`^:local\\s+${key}\\s+(.+)$`, "m"));
    if (!match) {
      continue;
    }

    const rawValue = match[1].trim();
    variables[key] = parseRouterValue(rawValue) as never;
  }

  return variables;
}

export function updateScriptVariables(script: string, variables: ScriptVariables): string {
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

export function normalizeVariables(input: Partial<ScriptVariables>): ScriptVariables {
  return {
    ssid: normalizeString(input.ssid, defaults.ssid),
    wifiPassword: normalizeString(input.wifiPassword, defaults.wifiPassword),
    wifiInterfaces: normalizeStringArray(input.wifiInterfaces, defaults.wifiInterfaces),
    backupWifiInterface: normalizeString(input.backupWifiInterface, defaults.backupWifiInterface),
    useWifi2Backup: input.useWifi2Backup === true,
    natComment: normalizeString(input.natComment, defaults.natComment),
    dhcpCommentPrefix: normalizeString(input.dhcpCommentPrefix, defaults.dhcpCommentPrefix),
    internetCheckTargets: normalizeStringArray(
      input.internetCheckTargets,
      defaults.internetCheckTargets,
    ),
  };
}

function parseRouterValue(rawValue: string): string | boolean | string[] {
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

function formatRouterValue(value: ScriptVariables[EditableKey]): string {
  if (Array.isArray(value)) {
    return `{${value.map(formatRouterString).join(";")}}`;
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return formatRouterString(value);
}

function parseRouterString(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) {
    return trimmed;
  }

  return trimmed.slice(1, -1)
    .replaceAll('\\"', '"')
    .replaceAll("\\$", "$")
    .replaceAll("\\\\", "\\");
}

function formatRouterString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("$", "\\$")}"`;
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const normalized = value.map((item) => String(item).trim()).filter(Boolean);
  return normalized.length ? normalized : [...fallback];
}
