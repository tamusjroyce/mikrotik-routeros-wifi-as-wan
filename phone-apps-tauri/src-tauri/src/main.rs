mod router_backend;

use router_backend::{ApplyPayload, RouterBackend, RouterSettings, UndoPayload};

#[tauri::command]
async fn router_status(payload: RouterSettings) -> Result<serde_json::Value, String> {
  RouterBackend::new(payload)?.status().await
}

#[tauri::command]
async fn router_apply(payload: ApplyPayload) -> Result<serde_json::Value, String> {
  let backend = RouterBackend::new(payload.router)?;
  let result = backend.apply_script(&payload.content).await?;
  serde_json::to_value(result).map_err(|error| error.to_string())
}

#[tauri::command]
async fn router_undo(payload: UndoPayload) -> Result<serde_json::Value, String> {
  let backend = RouterBackend::from_undo(payload)?;
  let undo_content = include_str!("../../../../mikrotek-scripts/undo-wifi-as-wan.rsc");
  let result = backend.apply_script(undo_content).await?;
  serde_json::to_value(result).map_err(|error| error.to_string())
}

fn main() {
  tauri::Builder::default()
    .setup(|app| {
      if let Some(window) = app.get_webview_window("main") {
        window.eval(
          r#"
            window.__routerBackendInvoke = async (action, payload) => {
              if (!window.__TAURI_INTERNALS__?.invoke) {
                throw new Error("Tauri backend bridge is unavailable.");
              }
              return await window.__TAURI_INTERNALS__.invoke(`router_${action}`, payload);
            };
          "#,
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![router_status, router_apply, router_undo])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
