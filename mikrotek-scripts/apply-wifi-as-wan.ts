import { chromium, type Locator, type Page } from "npm:playwright";

type RouterConfig = {
  url: string;
  username: string;
  password: string;
  headless: boolean;
  browserExecutablePath: string;
  cdpPort: number;
  actionDelayMs: number;
  scriptPath: string;
  routerFileName: string;
  schedulerName: string;
  postApplyWaitMs: number;
};

const config: RouterConfig = {
  url: Deno.env.get("ROUTER_URL") ?? "http://192.168.88.1",
  username: Deno.env.get("ROUTER_USER") ?? "admin",
  password: Deno.env.get("ROUTER_PASSWORD") ?? "blueberry64",
  headless: (Deno.env.get("HEADLESS") ?? "false").toLowerCase() === "true",
  browserExecutablePath: Deno.env.get("BROWSER_EXECUTABLE_PATH") ??
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  cdpPort: Number(Deno.env.get("BROWSER_CDP_PORT") ?? "9223"),
  actionDelayMs: Number(Deno.env.get("ACTION_DELAY_MS") ?? "1500"),
  scriptPath: getArgValue("--script") ?? "enable-wifi-as-wan.rsc",
  routerFileName: Deno.env.get("ROUTER_SCRIPT_FILE") ?? "enable-wifi-as-wan.rsc",
  schedulerName: Deno.env.get("ROUTER_SCHEDULER") ?? "enable-wifi-as-wan-every-minute",
  postApplyWaitMs: Number(Deno.env.get("POST_APPLY_WAIT_MS") ?? "10000"),
};

try {
  await main(config);
  if (!config.headless) {
    Deno.exit(0);
  }
} catch (error) {
  console.error("Apply wifi-as-wan failed:");
  console.error(error);
  Deno.exit(1);
}

async function main(routerConfig: RouterConfig) {
  await uploadScriptToRouter(routerConfig);
  await importScriptOnRouter(routerConfig);

  const installCommands = buildInstallCommands(routerConfig);
  await setWindowsClipboard(installCommands);

  console.log(`Opening ${routerConfig.url} with Playwright.`);
  console.log(`Prepared startup installer commands on the Windows clipboard.`);

  const browserSession = await openBrowserSession(routerConfig);
  const browser = browserSession.browser;
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.newPage();

  try {
    await login(page, routerConfig);
    await openConsole(page, routerConfig);
    await pasteCommandsIntoConsole(page, routerConfig);

    console.log("Startup installer commands were pasted into the router console.");
    console.log(`Waiting ${routerConfig.postApplyWaitMs}ms for router output.`);
    await delay(routerConfig.postApplyWaitMs);

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

async function importScriptOnRouter(routerConfig: RouterConfig) {
  const response = await fetch(new URL("/rest/import", routerConfig.url), {
    method: "POST",
    headers: {
      "Authorization": `Basic ${btoa(`${routerConfig.username}:${routerConfig.password}`)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ "file-name": routerConfig.routerFileName }),
  });

  if (!response.ok) {
    throw new Error(`Failed to import script through RouterOS REST: ${await response.text()}`);
  }
}

async function uploadScriptToRouter(routerConfig: RouterConfig) {
  await Deno.stat(routerConfig.scriptPath);

  const host = new URL(routerConfig.url).hostname;
  const ftpUrl = `ftp://${host}/${encodeURIComponent(routerConfig.routerFileName)}`;
  console.log(
    `Uploading ${routerConfig.scriptPath} to router file ${routerConfig.routerFileName}.`,
  );

  const output = await new Deno.Command("curl.exe", {
    args: [
      "--fail",
      "--silent",
      "--show-error",
      "--user",
      `${routerConfig.username}:${routerConfig.password}`,
      "--upload-file",
      routerConfig.scriptPath,
      ftpUrl,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();

  if (!output.success) {
    const stderr = new TextDecoder().decode(output.stderr).trim();
    throw new Error(`Failed to upload script to RouterOS Files over FTP: ${stderr}`);
  }
}

function buildInstallCommands(routerConfig: RouterConfig): string {
  const schedulerName = routerOsQuoted(routerConfig.schedulerName);
  const oldStartupSchedulerName = routerOsQuoted("enable-wifi-as-wan-on-startup");
  const fileName = routerConfig.routerFileName;
  const importCommand = `/import file-name=${fileName}`;

  return [
    `/system scheduler remove [find name=${schedulerName}]`,
    `/system scheduler remove [find name=${oldStartupSchedulerName}]`,
    `/system scheduler add name=${schedulerName} start-time=startup interval=1m on-event=${
      routerOsQuoted(importCommand)
    }`,
    importCommand,
    `/file print detail where name=${routerOsQuoted(fileName)}`,
    `/system scheduler print detail where name=${schedulerName}`,
    "",
  ].join("\r\n");
}

function routerOsQuoted(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("$", "\\$")}"`;
}

async function setWindowsClipboard(text: string) {
  const process = new Deno.Command("powershell", {
    args: ["-NoProfile", "-Command", "$input | Set-Clipboard"],
    stdin: "piped",
    stdout: "null",
    stderr: "piped",
  }).spawn();

  const writer = process.stdin.getWriter();
  await writer.write(new TextEncoder().encode(text));
  await writer.close();

  const status = await process.status;
  if (!status.success) {
    const stderr = await new Response(process.stderr).text();
    throw new Error(`Failed to set Windows clipboard: ${stderr}`);
  }
}

async function openBrowserSession(routerConfig: RouterConfig) {
  const userDataDir = await Deno.makeTempDir({ prefix: "router-apply-edge-" });
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
  console.log("Router console is ready.");
}

async function pasteCommandsIntoConsole(page: Page, routerConfig: RouterConfig) {
  const input = await findConsoleInput(page);
  await input.click();
  await actionDelay(routerConfig);
  await page.keyboard.press("Control+V");
  await actionDelay(routerConfig);
  await page.keyboard.press("Enter");
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

function getArgValue(name: string): string | undefined {
  const index = Deno.args.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  return Deno.args[index + 1];
}
