# Phone Apps iOS

Native iPhone shell for `phone-apps/web` using SwiftUI + WKWebView.

## Approach

- Bundle a copy of `../phone-apps/web` into the app as `Web/`.
- Load `Web/index.html` in `WKWebView`.
- Inject `window.__routerBackendInvoke(action, payload)` from Swift.
- Let the shared web UI try direct browser RouterOS calls first. If those fail, it uses the Swift
  backend bridge.

## Files

- `WiFiAsWanApp.swift`: app entry point.
- `WebAppView.swift`: WKWebView host and JS bridge plumbing.
- `RouterBackend.swift`: RouterOS REST client implemented with `URLSession`.
- `sync-web.ps1`: copies `../phone-apps/web` into `Web/` for bundling in Xcode.

## Practical Note

If you want one supported replacement for PhoneGap/Cordova instead of separate native shells,
Capacitor is the simplest current choice. This folder exists because you explicitly asked for a
native Swift wrapper.
