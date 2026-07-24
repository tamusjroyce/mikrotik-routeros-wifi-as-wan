# mikrotik-routeros-wifi-as-wan

RouterOS WiFi-as-WAN automation for MikroTik devices, plus browser and native
control apps.

This repo was built with GitHub Copilot and ChatGPT Codex. Some code is vibe, has not been reviewed. Some code has been reviewed

## 1. Script

The main script is
[mikrotek-scripts/enable-wifi-as-wan.rsc](C:/Users/tamus/projects/router/wifi-as-wan/mikrotek-scripts/enable-wifi-as-wan.rsc:1).

What it does:

- Targets RouterOS v7 `/interface wifi`
- Configures `wifi1` as the primary station-mode WAN uplink
- Optionally uses `wifi2` as a backup uplink
- Disables and removes `wifi2` from WAN when backup mode is off
- Pings configured internet targets before making changes and exits early if
  internet is already up
- Ensures DHCP client, WAN list membership, routes, and NAT are set for WiFi WAN
  use

Manual use on the router:

1. Copy `enable-wifi-as-wan.rsc` to the router `Files` area.
2. Open RouterOS terminal, SSH, or WebFig terminal.
3. Import it with:

```routeros
/import file-name=enable-wifi-as-wan.rsc
```

4. Check results with:

```routeros
/interface wifi registration-table print
/ip dhcp-client print detail
/ip route print detail where dst-address="0.0.0.0/0"
/ip firewall nat print detail
```

Undo script:

- [mikrotek-scripts/undo-wifi-as-wan.rsc](C:/Users/tamus/projects/router/wifi-as-wan/mikrotek-scripts/undo-wifi-as-wan.rsc:1)
  restores WiFi radios to AP mode and removes WiFi-as-WAN changes.

Automation helpers:

- [mikrotek-scripts/apply-wifi-as-wan.ts](C:/Users/tamus/projects/router/wifi-as-wan/mikrotek-scripts/apply-wifi-as-wan.ts:1)
  uploads the script and applies it through browser automation against RouterOS.

## 2. Apps

### `phone-apps`

[phone-apps](C:/Users/tamus/projects/router/wifi-as-wan/phone-apps) is the main
shared app.

- PWA-first web UI
- Tries direct browser calls to `http://192.168.88.1` or the configured router
  URL first
- Falls back to a backend when browser access fails
- Can edit, upload, import, and undo the RouterOS script
- Shows router reachability, active WAN, script state, and WiFi status

### `phone-apps-tauri`

[phone-apps-tauri](C:/Users/tamus/projects/router/wifi-as-wan/phone-apps-tauri)
is the desktop-native wrapper.

- Reuses the `phone-apps/web` frontend
- Adds a Rust backend bridge through Tauri
- Best fit for Windows/Linux/macOS desktop packaging

### `phone-apps-ios`

[phone-apps-ios](C:/Users/tamus/projects/router/wifi-as-wan/phone-apps-ios) is
the native Swift iPhone shell.

- Uses `WKWebView`
- Injects a native backend bridge into the shared web app
- Intended for a real App Store style native wrapper rather than a pure browser
  PWA

### `phone-apps-android`

[phone-apps-android](C:/Users/tamus/projects/router/wifi-as-wan/phone-apps-android)
is the native Kotlin Android shell.

- Uses `WebView`
- Injects a native backend bridge into the shared web app
- Intended for Play Store or sideloaded native Android packaging

## 3. e2e Tests

There are two e2e areas:

### Router automation e2e

[e2e](C:/Users/tamus/projects/router/wifi-as-wan/e2e) contains RouterOS browser
automation against the actual router UI.

It covers:

- Opening the router console
- Checking whether uploaded script files exist
- Checking router-side external ping behavior

### App e2e

[phone-apps/e2e](C:/Users/tamus/projects/router/wifi-as-wan/phone-apps/e2e)
covers the app itself with Playwright.

It covers:

- PWA load
- Default variable load
- Router status rendering
- Script editor interactions
- Upload/apply and undo flows

## Structure

- [mikrotek-scripts](C:/Users/tamus/projects/router/wifi-as-wan/mikrotek-scripts)
- [phone-apps](C:/Users/tamus/projects/router/wifi-as-wan/phone-apps)
- [phone-apps-tauri](C:/Users/tamus/projects/router/wifi-as-wan/phone-apps-tauri)
- [phone-apps-ios](C:/Users/tamus/projects/router/wifi-as-wan/phone-apps-ios)
- [phone-apps-android](C:/Users/tamus/projects/router/wifi-as-wan/phone-apps-android)
- [e2e](C:/Users/tamus/projects/router/wifi-as-wan/e2e)
- [pc-scripts](C:/Users/tamus/projects/router/wifi-as-wan/pc-scripts)

## Typical Commands

Shared app:

```cmd
cd phone-apps
deno task dev
deno task check
deno task test
deno task test:e2e
```

Router e2e:

```cmd
cd e2e
deno task router:console
deno task test:file-present
deno task test:external-ping
```

Script apply helper:

```cmd
cd mikrotek-scripts
deno task apply:wifi-as-wan
```

## Notes

- The repo currently uses `mikrotek-scripts` as a folder name, but the
  product/vendor name is `MikroTik`.
- Direct browser access to local router HTTP endpoints can fail on some
  platforms due to mixed-content, CORS, or local-network restrictions.
- That is why the apps now support backend fallback.
