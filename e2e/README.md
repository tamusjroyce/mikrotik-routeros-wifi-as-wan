# Router e2e

Deno + Playwright automation for the MikroTik router at `http://192.168.88.1`.

## Setup

This script uses installed Microsoft Edge through Playwright's CDP connection, so it does not need
Playwright to download Chromium.

## Open the Router Console

```cmd
deno task router:console
```

By default this uses:

- `ROUTER_URL=http://192.168.88.1`
- `ROUTER_USER=admin`
- `ROUTER_PASSWORD=blueberry64`
- `HEADLESS=false`
- `ACTION_DELAY_MS=1500`
- `BROWSER_EXECUTABLE_PATH=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`

You can override them from `cmd`:

```cmd
set ROUTER_PASSWORD=your-password
set ACTION_DELAY_MS=2000
deno task router:console
```

Use `set HEADLESS=true` only when you do not want to see the browser.

## Enter Future RouterOS Scripts

Run one command:

```cmd
deno task router:console -- --command "/interface print"
```

Run a script file:

```cmd
deno task router:console -- --script ..\mikrotek-scripts\enable-wifi-as-wan.rsc
```

## Check Uploaded Script File

```cmd
deno task test:file-present
```

This opens WebFig Terminal with Playwright and checks whether RouterOS Files still contains
`enable-wifi-as-wan.rsc`. A reset router should fail this test until the script is uploaded again.

## Check External Ping

```cmd
deno task test:external-ping
```

This opens WebFig Tools Ping with Playwright and checks router-side ping results for
`150.171.28.10`. It also opens the console and runs `ping` for both `150.171.28.10` and `bing.com`.
Override the tool target with `ROUTER_TOOL_PING_TARGET`, and override console targets with
`ROUTER_CONSOLE_PING_TARGETS`, comma-separated.
