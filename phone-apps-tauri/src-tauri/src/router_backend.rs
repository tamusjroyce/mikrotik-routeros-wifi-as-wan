use reqwest::{Client, Method};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Deserialize)]
pub struct RouterSettings {
  pub url: String,
  pub username: String,
  pub password: Option<String>,
  pub scriptFile: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ApplyPayload {
  #[serde(flatten)]
  pub router: RouterSettings,
  pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UndoPayload {
  pub url: String,
  pub username: String,
  pub password: Option<String>,
  pub scriptFileUndo: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ApplyResult {
  pub uploaded: bool,
  pub imported: bool,
  pub fileName: String,
  pub message: String,
}

pub struct RouterBackend {
  base_url: String,
  username: String,
  password: String,
  script_file: String,
  client: Client,
}

impl RouterBackend {
  pub fn new(settings: RouterSettings) -> Result<Self, String> {
    Ok(Self {
      base_url: settings.url.trim_end_matches('/').to_string(),
      username: settings.username,
      password: settings.password.unwrap_or_default(),
      script_file: settings.scriptFile,
      client: Client::builder().build().map_err(|error| error.to_string())?,
    })
  }

  pub fn from_undo(payload: UndoPayload) -> Result<Self, String> {
    Self::new(RouterSettings {
      url: payload.url,
      username: payload.username,
      password: payload.password,
      scriptFile: payload.scriptFileUndo.unwrap_or_else(|| "undo-wifi-as-wan.rsc".to_string()),
    })
  }

  pub async fn status(&self) -> Result<Value, String> {
    let files = self.request_json(Method::GET, "/rest/file", None).await?;
    let wifi = self.request_json(Method::GET, "/rest/interface/wifi", None).await?;
    let registrations = self
      .request_json(Method::GET, "/rest/interface/wifi/registration-table", None)
      .await?;
    let dhcp_clients = self
      .request_json(Method::GET, "/rest/ip/dhcp-client", None)
      .await?;
    let routes = self.request_json(Method::GET, "/rest/ip/route", None).await?;
    let schedulers = self
      .request_json(Method::GET, "/rest/system/scheduler", None)
      .await?;
    let internet_reachable = self.ping_any(&["1.1.1.1", "8.8.8.8"]).await.unwrap_or(false);

    let routes_array = as_array(&routes);
    let files_array = as_array(&files);
    let schedulers_array = as_array(&schedulers);
    let registrations_array = as_array(&registrations);
    let wifi_array = as_array(&wifi);

    let active_route = routes_array.iter().find(|route| {
      route.get("dst-address") == Some(&Value::String("0.0.0.0/0".to_string()))
        && route.get("inactive") == Some(&Value::String("false".to_string()))
    });
    let active_wan_interface = active_route
      .and_then(|route| route.get("vrf-interface").or_else(|| route.get("gateway")))
      .and_then(Value::as_str)
      .map(ToOwned::to_owned);
    let script_uploaded = files_array.iter().any(|file| {
      file.get("name").and_then(Value::as_str) == Some(self.script_file.as_str())
    });
    let scheduler_installed = schedulers_array.iter().any(|scheduler| {
      scheduler
        .get("name")
        .and_then(Value::as_str)
        .map(|value| value.contains("wifi-as-wan"))
        .unwrap_or(false)
    });

    Ok(json!({
      "reachable": true,
      "internetReachable": internet_reachable,
      "activeWanInterface": active_wan_interface,
      "scriptUploaded": script_uploaded,
      "schedulerInstalled": scheduler_installed,
      "bandwidth": build_bandwidth(active_wan_interface.as_deref(), &wifi_array, &registrations_array),
      "wifi": wifi,
      "registrations": registrations,
      "dhcpClients": dhcp_clients,
      "routes": routes
    }))
  }

  pub async fn apply_script(&self, content: &str) -> Result<ApplyResult, String> {
    self.upload_script(content).await?;
    self.import_script().await?;

    Ok(ApplyResult {
      uploaded: true,
      imported: true,
      fileName: self.script_file.clone(),
      message: format!("Uploaded and imported {}", self.script_file),
    })
  }

  pub async fn upload_script(&self, content: &str) -> Result<(), String> {
    let files = self
      .request_json(
        Method::POST,
        "/rest/file/print",
        Some(json!({ ".proplist": [".id", "name"] })),
      )
      .await?;
    let file_id = as_array(&files).iter().find_map(|file| {
      if file.get("name").and_then(Value::as_str) == Some(self.script_file.as_str()) {
        file.get(".id").and_then(Value::as_str).map(ToOwned::to_owned)
      } else {
        None
      }
    });

    if let Some(file_id) = file_id {
      self
        .request_json(
          Method::PATCH,
          &format!("/rest/file/{}", file_id),
          Some(json!({ "contents": content })),
        )
        .await?;
      return Ok(());
    }

    let create = self
      .request_json(
        Method::PUT,
        "/rest/file",
        Some(json!({
          "name": self.script_file,
          "type": "file",
          "contents": content
        })),
      )
      .await;
    if create.is_ok() {
      return Ok(());
    }

    self
      .request_json(
        Method::PUT,
        "/rest/file",
        Some(json!({ "name": self.script_file, "type": "file" })),
      )
      .await?;
    let files = self
      .request_json(
        Method::POST,
        "/rest/file/print",
        Some(json!({ ".proplist": [".id", "name"] })),
      )
      .await?;
    let file_id = as_array(&files).iter().find_map(|file| {
      if file.get("name").and_then(Value::as_str) == Some(self.script_file.as_str()) {
        file.get(".id").and_then(Value::as_str).map(ToOwned::to_owned)
      } else {
        None
      }
    });
    let file_id = file_id.ok_or_else(|| format!("Could not locate {}", self.script_file))?;
    self
      .request_json(
        Method::PATCH,
        &format!("/rest/file/{}", file_id),
        Some(json!({ "contents": content })),
      )
      .await?;
    Ok(())
  }

  pub async fn import_script(&self) -> Result<(), String> {
    self
      .request_json(
        Method::POST,
        "/rest/import",
        Some(json!({ "file-name": self.script_file })),
      )
      .await?;
    Ok(())
  }

  async fn ping_any(&self, targets: &[&str]) -> Result<bool, String> {
    for target in targets {
      let result = self
        .request_json(
          Method::POST,
          "/rest/ping",
          Some(json!({ "address": target, "count": "2" })),
        )
        .await;
      if let Ok(value) = result {
        let received = as_array(&value)
          .iter()
          .filter_map(|row| row.get("received").and_then(Value::as_str))
          .filter_map(|value| value.parse::<i64>().ok())
          .sum::<i64>();
        if received > 0 {
          return Ok(true);
        }
      }
    }
    Ok(false)
  }

  async fn request_json(
    &self,
    method: Method,
    path: &str,
    body: Option<Value>,
  ) -> Result<Value, String> {
    let mut request = self
      .client
      .request(method, format!("{}{}", self.base_url, path))
      .basic_auth(&self.username, Some(&self.password));
    if let Some(body) = body {
      request = request.json(&body);
    }

    let response = request.send().await.map_err(|error| error.to_string())?;
    if !response.status().is_success() {
      let status = response.status();
      let body = response.text().await.unwrap_or_default();
      return Err(format!("RouterOS REST {} failed: {} {}", path, status, body));
    }

    let text = response.text().await.map_err(|error| error.to_string())?;
    if text.trim().is_empty() {
      Ok(json!({}))
    } else {
      serde_json::from_str(&text).map_err(|error| error.to_string())
    }
  }
}

fn as_array(value: &Value) -> Vec<Value> {
  match value {
    Value::Array(array) => array.clone(),
    Value::Object(map) => map
      .get("value")
      .and_then(Value::as_array)
      .cloned()
      .unwrap_or_default(),
    _ => Vec::new(),
  }
}

fn build_bandwidth(active_wan_interface: Option<&str>, wifi: &[Value], registrations: &[Value]) -> Value {
  let active_registration = registrations.iter().find(|registration| {
    registration.get("interface").and_then(Value::as_str) == active_wan_interface
  });
  let active_wifi = wifi
    .iter()
    .find(|wifi_interface| wifi_interface.get("name").and_then(Value::as_str) == active_wan_interface);

  if active_registration.is_none() && active_wifi.is_none() {
    return json!({
      "activeInterface": active_wan_interface,
      "note": "RouterOS device-mode blocks active bandwidth-test. Showing live interface rates when available."
    });
  }

  json!({
    "activeInterface": active_wan_interface,
    "rxBitsPerSecond": active_registration.and_then(|value| value.get("rx-bits-per-second")).and_then(number_from_router),
    "txBitsPerSecond": active_registration.and_then(|value| value.get("tx-bits-per-second")).and_then(number_from_router),
    "rxRate": active_registration.and_then(|value| value.get("rx-rate")).and_then(number_from_router),
    "txRate": active_registration.and_then(|value| value.get("tx-rate")).and_then(number_from_router),
    "signal": active_registration.and_then(|value| value.get("signal")).and_then(Value::as_str),
    "note": "RouterOS device-mode blocks active bandwidth-test. These values are live WiFi link/traffic counters, not an internet speed test."
  })
}

fn number_from_router(value: &Value) -> Option<i64> {
  match value {
    Value::String(text) => text.parse::<i64>().ok(),
    Value::Number(number) => number.as_i64(),
    _ => None,
  }
}
