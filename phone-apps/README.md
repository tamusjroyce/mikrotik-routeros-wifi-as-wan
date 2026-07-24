# Phone Apps

PWA-first control app for the MikroTik WiFi-as-WAN script. The installed app talks directly to
RouterOS REST from the browser. There is no router-control backend in production; Deno is only a
static file server for local development and e2e testing.

## Run

```cmd
deno task dev
```

Open `http://localhost:8787` from the PC. For deployment, copy `web/` to a normal static host or
serve it from RouterOS `www-ssl` so the PWA can install cleanly.

## Deployment Notes

- The PWA stores its working `.rsc` script and router profile in browser storage on each device.
- Router actions use direct browser calls to the RouterOS REST API at `192.168.88.1` by default, or
  whatever Router URL is entered in the form.
- Installed PWAs are secure contexts, so direct calls to `http://...` router URLs are blocked by
  mixed-content rules. For installable iPhone, Android, and desktop use, point the app at RouterOS
  HTTPS and trust the router certificate on the device.
- Serving the app from the router itself over `https://<router>/...` is the cleanest same-origin
  setup.

## What It Does

- Edits WiFi-as-WAN variables in a browser-local copy of the default `.rsc`.
- Uploads the script to RouterOS Files through RouterOS REST file operations.
- Imports the script through RouterOS REST.
- Uploads and imports `undo-wifi-as-wan.rsc` to restore WiFi radios to AP mode when you choose
  `Undo WiFi as WAN`.
- Shows `Install defaults` when the router script is missing, then `Overwrite with defaults` after
  the script is detected.
- Opens an `Upload RSC Script` tab with a RouterOS source editor for the default `.rsc`; the tab can
  `Load Script` with an overwrite confirmation, `Reload Initial Script`, `Apply Changes/Overwrite`,
  and `Save Changes` through the browser filesystem picker when available or a download fallback. It
  can also load from a local file picker, load from a URL, or post the script to a URL when the
  target server allows browser CORS.
- Shows router reachability, internet status, active WAN, uploaded script status, WiFi registration,
  DHCP, and routes.
- Installs as a PWA on iPhone, Android, Windows, Linux, and desktop browsers when served over HTTPS.

## Router Defaults

- `ROUTER_URL=http://192.168.88.1`
- `ROUTER_USER=admin`
- `ROUTER_PASSWORD` is read from the form only and is not persisted.
- `ROUTER_SCRIPT_FILE=enable-wifi-as-wan.rsc`

The UI persists the Router URL, username, selected script filename, and local script text on each
device. It does not persist the router password.

## Tests

```cmd
deno task fmt
deno task check
deno task test
deno task test:e2e
```

The e2e test starts the local app server and verifies the PWA loads variables from the real RouterOS
defaults and talks directly to RouterOS.

## Native Wrappers

Start with the PWA. If reliable background checks while a phone is locked are required, wrap `web/`
later with Capacitor for iOS/Android and Tauri for Windows/Linux.
