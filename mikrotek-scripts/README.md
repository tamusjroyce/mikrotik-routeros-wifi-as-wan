# MikroTik Scripts

RouterOS scripts and local Deno + Playwright helpers for applying them through WebFig Terminal.

## Apply Wi-Fi as WAN

`enable-wifi-as-wan.rsc` targets the RouterOS v7 WiFi package (`/interface wifi`) and configures
`wifi1` as the primary station-mode WAN uplink using the configured SSID and passphrase. `wifi2` can
be used as a backup by setting `useWifi2Backup` to `true` inside the script; it is currently set to
`false`, so the script disables `wifi2` and removes it from WAN before checking internet. After
applying the `wifi2` policy, it pings `1.1.1.1` and `8.8.8.8`; if either target replies, it exits
early and leaves the current primary internet path alone.

From this folder:

```cmd
deno task apply:wifi-as-wan
```

By default this uploads `enable-wifi-as-wan.rsc` to the router's top-level Files area, opens
`http://192.168.88.1`, logs in as `admin`, opens the router console, and pastes installer commands
that import the uploaded file now and register it to run at startup and every minute afterward.

Defaults:

- `ROUTER_URL=http://192.168.88.1`
- `ROUTER_USER=admin`
- `ROUTER_PASSWORD=blueberry64`
- `HEADLESS=false`
- `ACTION_DELAY_MS=1500`
- `POST_APPLY_WAIT_MS=10000`
- `BROWSER_CDP_PORT=9223`
- `BROWSER_EXECUTABLE_PATH=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
- `ROUTER_SCRIPT_FILE=enable-wifi-as-wan.rsc`
- `ROUTER_SCHEDULER=enable-wifi-as-wan-every-minute`

Use a different script file:

```cmd
deno task apply:wifi-as-wan -- --script enable-wifi-as-wan.rsc
```

Use a slower visible run:

```cmd
set ACTION_DELAY_MS=2000
deno task apply:wifi-as-wan
```

The runner uploads the script file over FTP using `curl.exe` to
`ftp://192.168.88.1/enable-wifi-as-wan.rsc`, which is the root of RouterOS Files. It only pastes
short RouterOS commands through the clipboard, which avoids escaping the full script body through
the terminal.
