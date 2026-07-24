import type {
  ApplyResult,
  BandwidthStatus,
  RouterSettings,
  RouterStatus,
} from "../shared/types.ts";

export type RouterClientOptions = Required<RouterSettings>;

export class RouterClient {
  #options: RouterClientOptions;

  constructor(options: RouterSettings) {
    this.#options = {
      url: options.url,
      username: options.username,
      password: options.password ?? "",
      scriptFile: options.scriptFile,
    };
  }

  async applyScript(scriptPath: string): Promise<ApplyResult> {
    await this.uploadScript(scriptPath);
    await this.importScript();

    return {
      uploaded: true,
      imported: true,
      fileName: this.#options.scriptFile,
      message: `Uploaded and imported ${this.#options.scriptFile}`,
    };
  }

  async applyScriptContent(content: string): Promise<ApplyResult> {
    const tempFile = await Deno.makeTempFile({ suffix: ".rsc" });
    try {
      await Deno.writeTextFile(tempFile, content);
      return await this.applyScript(tempFile);
    } finally {
      await Deno.remove(tempFile).catch(() => undefined);
    }
  }

  async getStatus(): Promise<RouterStatus> {
    try {
      const [files, wifi, registrations, dhcpClients, routes, schedulers] = await Promise.all([
        this.restGet<unknown[]>("/rest/file"),
        this.restGet<unknown[]>("/rest/interface/wifi"),
        this.restGet<unknown[]>("/rest/interface/wifi/registration-table"),
        this.restGet<unknown[]>("/rest/ip/dhcp-client"),
        this.restGet<unknown[]>("/rest/ip/route"),
        this.restGet<unknown[]>("/rest/system/scheduler"),
      ]);

      const activeRoute = routes.find((route) =>
        isRecord(route) && route["dst-address"] === "0.0.0.0/0" && route.inactive === "false"
      );
      const scriptUploaded = files.some((file) =>
        isRecord(file) && file.name === this.#options.scriptFile
      );
      const schedulerInstalled = schedulers.some((scheduler) =>
        isRecord(scheduler) && String(scheduler.name ?? "").includes("wifi-as-wan")
      );
      const internetReachable = await this.pingAny(["1.1.1.1", "8.8.8.8"]);
      const activeWanInterface = isRecord(activeRoute)
        ? String(activeRoute["vrf-interface"] ?? activeRoute.gateway ?? "")
        : undefined;

      return {
        reachable: true,
        internetReachable,
        activeWanInterface,
        scriptUploaded,
        schedulerInstalled,
        bandwidth: this.buildBandwidthStatus(activeWanInterface, wifi, registrations),
        wifi,
        registrations,
        dhcpClients,
        routes,
      };
    } catch (error) {
      return {
        reachable: false,
        internetReachable: false,
        scriptUploaded: false,
        schedulerInstalled: false,
        bandwidth: {},
        wifi: [],
        registrations: [],
        dhcpClients: [],
        routes: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async pingAny(targets: string[]): Promise<boolean> {
    for (const target of targets) {
      try {
        const result = await this.restCommand<Record<string, unknown>>("/rest/ping", {
          address: target,
          count: "2",
        });
        const rows = Array.isArray(result)
          ? result
          : Array.isArray(result.value)
          ? result.value
          : [result];
        const received = rows.reduce((total, row) => {
          if (!isRecord(row)) return total;
          return total + Number(row.received ?? 0);
        }, 0);
        if (received > 0) {
          return true;
        }
      } catch {
        // Try the next target.
      }
    }

    return false;
  }

  async getBandwidthStatus(): Promise<BandwidthStatus> {
    const status = await this.getStatus();
    return status.bandwidth;
  }

  buildBandwidthStatus(
    activeWanInterface: string | undefined,
    wifi: unknown[],
    registrations: unknown[],
  ): BandwidthStatus {
    const activeRegistrationValue = registrations.find((registration) =>
      isRecord(registration) && registration.interface === activeWanInterface
    );
    const activeRegistration = isRecord(activeRegistrationValue)
      ? activeRegistrationValue
      : undefined;
    const activeWifi = wifi.find((wifiInterface) =>
      isRecord(wifiInterface) && wifiInterface.name === activeWanInterface
    );

    if (!isRecord(activeRegistration) && !isRecord(activeWifi)) {
      return {
        activeInterface: activeWanInterface,
        note:
          "RouterOS device-mode blocks active bandwidth-test. Showing live interface rates when available.",
      };
    }

    return {
      activeInterface: activeWanInterface,
      rxBitsPerSecond: numberFromRouter(activeRegistration?.["rx-bits-per-second"]),
      txBitsPerSecond: numberFromRouter(activeRegistration?.["tx-bits-per-second"]),
      rxRate: numberFromRouter(activeRegistration?.["rx-rate"]),
      txRate: numberFromRouter(activeRegistration?.["tx-rate"]),
      signal: activeRegistration ? String(activeRegistration.signal ?? "") : undefined,
      note:
        "RouterOS device-mode blocks active bandwidth-test. These values are live WiFi link/traffic counters, not an internet speed test.",
    };
  }

  async uploadScript(scriptPath: string): Promise<void> {
    const host = new URL(this.#options.url).hostname;
    const ftpUrl = `ftp://${host}/${encodeURIComponent(this.#options.scriptFile)}`;
    const output = await new Deno.Command("curl.exe", {
      args: [
        "--fail",
        "--silent",
        "--show-error",
        "--user",
        `${this.#options.username}:${this.#options.password}`,
        "--upload-file",
        scriptPath,
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

  async importScript(): Promise<void> {
    await this.restPost("/rest/import", { "file-name": this.#options.scriptFile });
  }

  async restGet<T>(path: string): Promise<T> {
    return await this.restRequest<T>(path, { method: "GET" });
  }

  async restPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return await this.restRequest<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async restCommand<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return await this.restPost<T>(path, body);
  }

  async restRequest<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(new URL(path, this.#options.url), {
      ...init,
      headers: {
        "Authorization": `Basic ${btoa(`${this.#options.username}:${this.#options.password}`)}`,
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error(`RouterOS REST ${path} failed: ${response.status} ${await response.text()}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) as T : {} as T;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numberFromRouter(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
