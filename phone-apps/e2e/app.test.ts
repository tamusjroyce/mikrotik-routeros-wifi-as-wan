import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fromFileUrl } from "https://deno.land/std@0.224.0/path/from_file_url.ts";
import { chromium } from "npm:playwright";

const port = 8797;
const baseUrl = `http://127.0.0.1:${port}`;
const browserDebugPort = 9230;
const routerUrl = Deno.env.get("ROUTER_URL") ?? "http://192.168.88.1";
const routerUser = Deno.env.get("ROUTER_USER") ?? "admin";
const routerPassword = Deno.env.get("ROUTER_PASSWORD") ?? "blueberry64";
const browserHeadless = Deno.env.get("BROWSER_HEADLESS") !== "false";

Deno.test({
  name: "PWA loads variables and router controls",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const server = new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", "server/server.ts"],
      cwd: fromFileUrl(new URL("../", import.meta.url)),
      env: { PHONE_APP_PORT: String(port) },
      stdout: "null",
      stderr: "null",
    }).spawn();

    try {
      await waitForServer();
      const browserSession = await openBrowserSession();
      const browser = browserSession.browser;
      const page = browserSession.page;
      try {
        await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
        await page.getByRole("heading", { name: "WiFi as WAN" }).waitFor();

        await assertInputValue(page, "ssid", "LONG_PING_IS_LONG");
        await assertInputValue(page, "backupWifiInterface", "wifi2");
        await assertInputValue(page, "wifiInterfaces", "wifi1,wifi2");
        assertEquals(await page.locator('input[name="useWifi2Backup"]').isChecked(), false);
        await page.getByRole("button", { name: "Upload & Apply" }).waitFor();
        await page.getByRole("button", { name: "Undo WiFi as WAN" }).waitFor();
        await page.locator("#internetReachable", { hasText: "Online" }).waitFor({
          timeout: 15_000,
        });
        await page.getByRole("button", { name: "Overwrite with defaults" }).waitFor({
          timeout: 15_000,
        });
        await page.locator("#connectionPath", { hasText: "Direct" }).waitFor({
          timeout: 15_000,
        });
        await page.locator("#rxRate").waitFor({ timeout: 15_000 });
        await page.locator("#bandwidthNote", {
          hasText: /RouterOS device-mode blocks active bandwidth-test/,
        }).waitFor({
          timeout: 15_000,
        });
        await page.getByRole("button", { name: "Upload RSC Script" }).click();
        await page.locator("#scriptEditor").waitFor({ timeout: 15_000 });
        const scriptText = await page.locator("#scriptEditor").inputValue();
        assertEquals(scriptText.includes(':local ssid "LONG_PING_IS_LONG"'), true);
        await page.getByRole("button", { name: "Load Script" }).waitFor();
        await page.getByRole("button", { name: "Reload Initial Script" }).waitFor();
        await page.getByRole("button", { name: "Apply Changes/Overwrite" }).waitFor();
        await page.getByRole("button", { name: "Save Changes" }).waitFor();
        await page.getByRole("button", { name: "Save Changes" }).click();
        await page.locator("#saveDialog").waitFor({ state: "visible", timeout: 15_000 });
        await page.getByRole("button", { name: "Filesystem path" }).waitFor();
        await page.locator("#saveToUrl").waitFor();
        await page.getByRole("button", { name: "Download file" }).waitFor();
        await page.getByRole("button", { name: "Cancel" }).click();
        await page.getByRole("button", { name: "Reload Initial Script" }).click();
        await page.getByText("Initial script loaded. Save to keep these changes.").waitFor({
          timeout: 15_000,
        });
        const initialScriptText = await page.locator("#scriptEditor").inputValue();
        assertEquals(initialScriptText.includes(":local useWifi2Backup false"), true);
        await page.getByRole("button", { name: "Apply Changes/Overwrite" }).click();
        await page.getByText(/Uploaded and imported/).waitFor({ timeout: 30_000 });
        await page.locator("#backToControls").click();
        await page.getByRole("button", { name: "Overwrite with defaults" }).waitFor({
          timeout: 15_000,
        });
      } finally {
        await browser.close();
        try {
          browserSession.browserProcess.kill();
        } catch {
          // Browser may already be gone in visible mode.
        }
      }
    } finally {
      server.kill();
    }
  },
});

Deno.test({
  name: "PWA applies wifi2 disabled setting to live router",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const server = new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", "server/server.ts"],
      cwd: fromFileUrl(new URL("../", import.meta.url)),
      env: { PHONE_APP_PORT: String(port) },
      stdout: "null",
      stderr: "null",
    }).spawn();

    try {
      await waitForServer();
      const browserSession = await openBrowserSession();
      const browser = browserSession.browser;
      const page = browserSession.page;
      try {
        await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
        await page.getByRole("heading", { name: "WiFi as WAN" }).waitFor();
        await page.locator('input[name="url"]').fill(routerUrl);
        await page.locator('input[name="username"]').fill(routerUser);
        await page.locator('input[name="password"]').fill(routerPassword);
        await page.locator('input[name="useWifi2Backup"]').setChecked(false);
        await page.getByRole("button", { name: "Upload & Apply" }).click();
        await waitForRouterWifi2Disabled();
        await page.locator("#scriptUploaded", { hasText: "Uploaded" }).waitFor({
          timeout: 15_000,
        });
      } finally {
        await browser.close();
        try {
          browserSession.browserProcess.kill();
        } catch {
          // Browser may already be gone in visible mode.
        }
      }
    } finally {
      server.kill();
    }
  },
});

async function openBrowserSession() {
  const userDataDir = await Deno.makeTempDir({ prefix: "phone-app-e2e-edge-" });
  const startUrl = browserHeadless ? "about:blank" : baseUrl;
  const browserProcess = new Deno.Command(
    Deno.env.get("BROWSER_EXECUTABLE_PATH") ??
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    {
      args: [
        ...(browserHeadless ? ["--headless=new"] : []),
        `--remote-debugging-port=${browserDebugPort}`,
        `--user-data-dir=${userDataDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        startUrl,
      ],
      stdout: "null",
      stderr: "null",
    },
  ).spawn();

  await waitForCdp(browserDebugPort);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${browserDebugPort}`);
  const context = browser.contexts()[0] ?? await browser.newContext();
  const page = context.pages()[0] ?? await context.newPage();
  await page.bringToFront();
  return { browser, browserProcess, page };
}

async function waitForCdp(portNumber: number) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${portNumber}/json/version`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error(`Timed out waiting for Edge CDP on port ${portNumber}`);
}

async function assertInputValue(page: import("npm:playwright").Page, name: string, value: string) {
  assertEquals(await page.locator(`input[name="${name}"]`).inputValue(), value);
}

async function waitForServer() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error("Timed out waiting for phone app server");
}

async function waitForRouterWifi2Disabled() {
  let lastWifi2State = "not seen";
  for (let attempt = 1; attempt <= 10; attempt++) {
    const wifi = await routerRest<unknown[]>("/rest/interface/wifi");
    const wifi2 = wifi.find((item) => isRecord(item) && item.name === "wifi2");
    lastWifi2State = JSON.stringify(wifi2 ?? null);
    if (isRecord(wifi2) && wifi2.disabled === "true") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }

  throw new Error(`wifi2 was not disabled after 10 checks. Last state: ${lastWifi2State}`);
}

async function routerRest<T>(path: string): Promise<T> {
  const response = await fetch(new URL(path, routerUrl), {
    headers: {
      "Authorization": `Basic ${btoa(`${routerUser}:${routerPassword}`)}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Router REST ${path} failed: ${response.status} ${await response.text()}`);
  }

  return await response.json() as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
