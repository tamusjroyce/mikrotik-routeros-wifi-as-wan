# Phone Apps Tauri

Desktop-native wrapper for `../phone-apps/web` using Tauri 2.x.

## Why This Exists

- `phone-apps` stays the shared web UI.
- The Tauri shell provides a native backend bridge when the webview cannot call the router directly.
- Desktop builds can still use direct RouterOS access first, then fall back to the Rust backend.

## Layout

- `src-tauri/` contains the Rust shell and backend commands.
- The frontend is read directly from `../phone-apps/web`.

## Notes

- This project assumes the shared web app keeps the `window.__routerBackendInvoke(action, payload)`
  contract.
- The Rust backend uses RouterOS REST for status, file upload/update, and import.
- If you want a single modern PhoneGap successor instead of separate native shells, Capacitor is the
  simplest current choice for iOS + Android from one web codebase.
