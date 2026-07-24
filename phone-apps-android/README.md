# Phone Apps Android

Native Android shell for `phone-apps/web` using Kotlin + WebView.

## Approach

- Bundle a copy of `../phone-apps/web` into `app/src/main/assets/web/`.
- Load `file:///android_asset/web/index.html` in a `WebView`.
- Inject `window.__routerBackendInvoke(action, payload)` through a JavaScript interface.
- Let the shared web UI try direct RouterOS calls first, then fall back to the Kotlin backend when
  the browser path is blocked.

## Files

- `app/src/main/java/.../MainActivity.kt`: WebView host.
- `RouterBackendBridge.kt`: JS bridge entry point.
- `RouterClient.kt`: RouterOS REST backend.
- `sync-web.ps1`: copies `../phone-apps/web` into Android assets.

## Network

- `network_security_config.xml` allows cleartext traffic for local router development.
- If you switch the router to HTTPS, remove the cleartext exceptions and trust the certificate
  normally.
