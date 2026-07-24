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
  expectedFileName: string;
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
  cdpPort: Number(Deno.env.get("BROWSER_CDP_PORT") ?? "9224"),
  actionDelayMs: Number(Deno.env.get("ACTION_DELAY_MS") ?? "1500"),
  expectedFileName: Deno.env.get("ROUTER_SCRIPT_FILE") ?? "enable-wifi-as-wan.rsc",
};

Deno.test({
  name: "RouterOS Files still contains uploaded wifi-as-wan script",
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
      await assertRouterFilePresent(config);
    } finally {
      await browser.close();
      browserSession.browserProcess.kill();
    }
  },
});

async function assertRouterFilePresent(routerConfig: RouterConfig) {
  const host = new URL(routerConfig.url).hostname;
  const output = await new Deno.Command("curl.exe", {
    args: [
      "--silent",
      "--show-error",
      "--user",
      `${routerConfig.username}:${routerConfig.password}`,
      `ftp://${host}/`,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();

  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);

  assert(
    output.success,
    `Could not list RouterOS Files over FTP. ${stderr}`,
  );

  assert(
    stdout.includes(routerConfig.expectedFileName),
    `RouterOS file ${routerConfig.expectedFileName} was not found in Files. The router may have been reset or the script was not uploaded.`,
  );
}

async function openBrowserSession(routerConfig: RouterConfig): Promise<BrowserSession> {
  const userDataDir = await Deno.makeTempDir({ prefix: "router-file-test-edge-" });
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
