import { chromium, type Locator, type Page } from "npm:playwright";

type RouterConfig = {
  url: string;
  username: string;
  password: string;
  headless: boolean;
  browserChannel?: string;
  browserExecutablePath?: string;
  cdpPort: number;
  actionDelayMs: number;
  command?: string;
  scriptPath?: string;
};

const config: RouterConfig = {
  url: Deno.env.get("ROUTER_URL") ?? "http://192.168.88.1",
  username: Deno.env.get("ROUTER_USER") ?? "admin",
  password: Deno.env.get("ROUTER_PASSWORD") ?? "blueberry64",
  headless: (Deno.env.get("HEADLESS") ?? "false").toLowerCase() === "true",
  browserChannel: Deno.env.get("BROWSER_CHANNEL"),
  browserExecutablePath: Deno.env.get("BROWSER_EXECUTABLE_PATH") ??
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  cdpPort: Number(Deno.env.get("BROWSER_CDP_PORT") ?? "9222"),
  actionDelayMs: Number(Deno.env.get("ACTION_DELAY_MS") ?? "1500"),
  command: getArgValue("--command"),
  scriptPath: getArgValue("--script"),
};

try {
  await main(config);
  if (!config.headless) {
    Deno.exit(0);
  }
} catch (error) {
  console.error("Router e2e failed:");
  console.error(error);
  Deno.exit(1);
}

async function main(routerConfig: RouterConfig) {
  console.log(`Opening ${routerConfig.url} with Playwright.`);

  const browserSession = await openBrowserSession(routerConfig);
  const browser = browserSession.browser;
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.newPage();

  try {
    await login(page, routerConfig);
    await openConsole(page, routerConfig);

    const script = await loadConsoleScript(routerConfig);
    if (script.trim()) {
      await enterConsoleScript(page, script, routerConfig);
    } else {
      console.log(
        'Router console is open. Pass --script path/to/file.rsc or --command "..." to enter commands.',
      );
    }

    if (!routerConfig.headless) {
      console.log("Leaving browser open for inspection.");
    }
  } finally {
    if (routerConfig.headless) {
      await browser.close();
      browserSession.browserProcess.kill();
    }
  }
}

async function openBrowserSession(routerConfig: RouterConfig) {
  const userDataDir = await Deno.makeTempDir({ prefix: "router-e2e-edge-" });
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

  console.log(`Starting browser at ${routerConfig.browserExecutablePath}.`);
  const browserProcess = new Deno.Command(routerConfig.browserExecutablePath!, {
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
  console.log("Router console is ready.");
}

async function isVisibleSoon(locator: Locator): Promise<boolean> {
  try {
    await locator.waitFor({ state: "visible", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

async function enterConsoleScript(page: Page, script: string, routerConfig: RouterConfig) {
  const input = await findConsoleInput(page);
  const commands = script.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (const command of commands) {
    console.log(`Entering: ${command}`);
    await input.fill(command);
    await actionDelay(routerConfig);
    await input.press("Enter");
    await actionDelay(routerConfig);
  }
}

async function actionDelay(routerConfig: RouterConfig) {
  await delay(routerConfig.actionDelayMs);
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

async function loadConsoleScript(routerConfig: RouterConfig): Promise<string> {
  if (routerConfig.command) {
    return routerConfig.command;
  }

  if (routerConfig.scriptPath) {
    return await Deno.readTextFile(routerConfig.scriptPath);
  }

  return "";
}

function getArgValue(name: string): string | undefined {
  const index = Deno.args.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  return Deno.args[index + 1];
}
