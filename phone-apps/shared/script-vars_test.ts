import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseScriptVariables, updateScriptVariables } from "./script-vars.ts";

const sampleScript = `:local ssid "LONG_PING_IS_LONG"
:local wifiPassword "pandaexpress"
:local wifiInterfaces {"wifi1";"wifi2"}
:local backupWifiInterface "wifi2"
:local useWifi2Backup false
:local natComment "wifi-as-wan masquerade"
:local dhcpCommentPrefix "wifi-as-wan dhcp client"
:local internetCheckTargets {"1.1.1.1";"8.8.8.8"}
:put "done"
`;

Deno.test("parseScriptVariables reads editable RouterOS locals", () => {
  assertEquals(parseScriptVariables(sampleScript), {
    ssid: "LONG_PING_IS_LONG",
    wifiPassword: "pandaexpress",
    wifiInterfaces: ["wifi1", "wifi2"],
    backupWifiInterface: "wifi2",
    useWifi2Backup: false,
    natComment: "wifi-as-wan masquerade",
    dhcpCommentPrefix: "wifi-as-wan dhcp client",
    internetCheckTargets: ["1.1.1.1", "8.8.8.8"],
  });
});

Deno.test("updateScriptVariables preserves script body and serializes values", () => {
  const updatedScript = updateScriptVariables(sampleScript, {
    ssid: "Cafe WiFi",
    wifiPassword: "pass$word",
    wifiInterfaces: ["wifi1"],
    backupWifiInterface: "wifi2",
    useWifi2Backup: true,
    natComment: "wifi nat",
    dhcpCommentPrefix: "dhcp client",
    internetCheckTargets: ["9.9.9.9"],
  });

  assertEquals(updatedScript.includes(':local ssid "Cafe WiFi"'), true);
  assertEquals(updatedScript.includes(':local wifiPassword "pass\\$word"'), true);
  assertEquals(updatedScript.includes(':local wifiInterfaces {"wifi1"}'), true);
  assertEquals(updatedScript.includes(":local useWifi2Backup true"), true);
  assertEquals(updatedScript.endsWith(':put "done"\n'), true);
});
