import { assert } from "https://deno.land/std@0.224.0/assert/assert.ts";
import { chromium, type Locator, type Page } from "npm:playwright";

type RouterConfig = {
  url: string;
  username: string;
  password: string;
  headless: boolean;
  browserExecutablePath: string;
  cdpPort: number;
  actionDelayMs: number;
  toolPingTarget: string;
  consolePingTargets: string[];
};

type BrowserSession = {
  browser: Awaited<ReturnType<typeof chromium.connectOverCDP>>;
  browserProcess: Deno.ChildProcess;
};

const config: RouterConfig = {
  url: Deno.env.get("ROUTER_URL") ?? "http://192.168.88.1",
  username: Deno.env.get("ROUTER_USER") ?? "admin",
  password: Deno.env.get("ROUTER_PASSWORD") ?? "blueberry64",
  headless: (Deno.env.get("HEADLESS") ?? "false").toLowerCase() === "true",
  browserExecutablePath: Deno.env.get("BROWSER_EXECUTABLE_PATH") ??
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  cdpPort: Number(Deno.env.get("BROWSER_CDP_PORT") ?? "9225"),
  actionDelayMs: Number(Deno.env.get("ACTION_DELAY_MS") ?? "1500"),
  toolPingTarget: Deno.env.get("ROUTER_TOOL_PING_TARGET") ?? "150.171.28.10",
  consolePingTargets: (Deno.env.get("ROUTER_CONSOLE_PING_TARGETS") ?? "150.171.28.10,bing.com")
    .split(",")
    .map((target) => target.trim())
    .filter(Boolean),
};

Deno.test({
  name: `Router Tools Ping can ping external IP ${config.toolPingTarget}`,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const browserSession = await openBrowserSession(config);
    const browser = browserSession.browser;
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? await context.newPage();

    try {
      await login(page, config);
      await openPingTool(page, config);
      await runToolPing(page, config, config.toolPingTarget);
    } finally {
      await browser.close();
      browserSession.browserProcess.kill();
    }
  },
});

Deno.test({
  name: `Router console prints ping diagnostics for ${config.consolePingTargets.join(", ")}`,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const browserSession = await openBrowserSession(config);
    const browser = browserSession.browser;
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? await context.newPage();

    try {
      await login(page, config);
      await openConsole(page, config);
      for (const pingTarget of config.consolePingTargets) {
        await runConsolePing(page, config, pingTarget);
      }
    } finally {
      await browser.close();
      browserSession.browserProcess.kill();
    }
  },
});

async function runToolPing(page: Page, routerConfig: RouterConfig, pingTarget: string) {
  const stopButton = page.getByRole("button", { name: /^stop$/i }).first();
  if (await stopButton.isVisible().catch(() => false)) {
    await stopButton.click();
    await actionDelay(routerConfig);
  }

  const pingInput = page.locator('xpath=//*[normalize-space()="Ping To"]/following::input[1]');

  await pingInput.waitFor({ state: "visible", timeout: 20_000 });
  await pingInput.fill(pingTarget);
  await actionDelay(routerConfig);

  const startButton = page.getByRole("button", { name: /^start$/i }).first();
  if (await startButton.count()) {
    await startButton.click();
  } else {
    await pingInput.press("Enter");
  }

  await page.getByRole("button", { name: /^stop$/i }).first().waitFor({
    state: "visible",
    timeout: 10_000,
  }).catch(() => undefined);

  await delay(12_000);
  const outputText = await page.locator("body").innerText();
  const loweredOutput = outputText.toLowerCase();

  assert(
    !loweredOutput.includes("no route to host"),
    `Router ping to ${pingTarget} failed: no route to host.`,
  );
  assert(
    !loweredOutput.includes("timeout"),
    `Router ping to ${pingTarget} failed: timeout.`,
  );
  assert(
    !loweredOutput.includes("could not") && !loweredOutput.includes("failure"),
    `Router ping to ${pingTarget} failed. Output included an error: ${outputText}`,
  );
  assert(
    /received\s*[1-9]/i.test(outputText) || /[0-9]+\s*ms/i.test(outputText),
    `Router ping to ${pingTarget} did not show any successful replies. Output: ${outputText}`,
  );
}

async function runConsolePing(page: Page, routerConfig: RouterConfig, pingTarget: string) {
  const command = `ping ${routerOsConsoleArg(pingTarget)} count=4`;
  const beforeText = await page.locator("body").innerText();
  const input = await findConsoleInput(page);

  console.log(`Console ping: ${pingTarget}`);
  await input.fill(command);
  await actionDelay(routerConfig);
  await input.press("Enter");
  await delay(8_000);

  const outputText = await page.locator("body").innerText();
  const newOutputText = outputText.slice(Math.min(beforeText.length, outputText.length));
  const relevantOutput = newOutputText.trim() ? newOutputText : outputText;
  const loweredOutput = relevantOutput.toLowerCase();

  console.log(relevantOutput);

  if (
    loweredOutput.includes("no route to host") || loweredOutput.includes("resolve failed") ||
    loweredOutput.includes("timeout")
  ) {
    console.log(`Console ping diagnostic for ${pingTarget} reported a router-side failure.`);
  }
}

async function openBrowserSession(routerConfig: RouterConfig): Promise<BrowserSession> {
  const userDataDir = await Deno.makeTempDir({ prefix: "router-ping-test-edge-" });
  const args = [
    `--remote-debugging-port=${routerConfig.cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "about:blank",
  ];

  if (routerConfig.headless) {
    args.unshift("--headless=new");
  }

  const browserProcess = new Deno.Command(routerConfig.browserExecutablePath, {
    args,
    stdout: "null",
    stderr: "null",
  }).spawn();

  await waitForCdp(routerConfig.cdpPort);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${routerConfig.cdpPort}`);
  return { browser, browserProcess };
}

async function waitForCdp(port: number) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        return;
      }
    } catch {
      await delay(250);
    }
  }

  throw new Error(`Browser CDP endpoint did not start on port ${port}.`);
}

async function login(page: Page, routerConfig: RouterConfig) {
  await page.goto(routerConfig.url, { waitUntil: "domcontentloaded" });
  await actionDelay(routerConfig);

  const username = page.locator(
    'input[name="username"], input[name="user"], input[type="text"], input:not([type])',
  ).first();
  const password = page.locator('input[name="password"], input[type="password"]').first();

  await username.waitFor({ state: "visible", timeout: 15_000 });
  await username.fill(routerConfig.username);
  await actionDelay(routerConfig);
  await password.fill(routerConfig.password);
  await actionDelay(routerConfig);

  const loginButton = page.getByRole("button", { name: /log\s*in|login|connect|sign\s*in/i })
    .first();
  if (await loginButton.count()) {
    await Promise.all([
      page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined),
      loginButton.click(),
    ]);
  } else {
    await Promise.all([
      page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined),
      password.press("Enter"),
    ]);
  }

  await page.waitForLoadState("domcontentloaded");
  await actionDelay(routerConfig);
}

async function openPingTool(page: Page, routerConfig: RouterConfig) {
  await page.goto(new URL("/webfig/#Tools:Ping", routerConfig.url).toString(), {
    waitUntil: "domcontentloaded",
  });
  await actionDelay(routerConfig);
  await page.getByText(/ping to/i).first().waitFor({ state: "visible", timeout: 20_000 });
}

async function openConsole(page: Page, routerConfig: RouterConfig) {
  const consoleLink = page.getByText(/terminal|console|new terminal/i).first();
  if (await isVisibleSoon(consoleLink)) {
    await consoleLink.click();
    await actionDelay(routerConfig);
  } else {
    await page.goto(new URL("/webfig/#Terminal", routerConfig.url).toString(), {
      waitUntil: "domcontentloaded",
    });
    await actionDelay(routerConfig);
  }

  await findConsoleInput(page).waitFor({ state: "visible", timeout: 20_000 });
}

function findConsoleInput(page: Page): Locator {
  return page.locator([
    "textarea:visible",
    'input[type="text"]:visible',
    '[contenteditable="true"]:visible',
    ".terminal input:visible",
    ".console input:visible",
  ].join(", ")).last();
}

async function isVisibleSoon(locator: Locator): Promise<boolean> {
  try {
    await locator.waitFor({ state: "visible", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

async function actionDelay(routerConfig: RouterConfig) {
  await delay(routerConfig.actionDelayMs);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function routerOsConsoleArg(value: string): string {
  if (/^[A-Za-z0-9.:_-]+$/.test(value)) {
    return value;
  }

  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("$", "\\$")}"`;
}
