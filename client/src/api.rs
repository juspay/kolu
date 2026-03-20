//! REST client helpers for the kolu terminal API.

use gloo_net::http::Request;
use kolu_common::*;

pub async fn create_terminal(req: &CreateTerminalRequest) -> Result<Terminal, String> {
  let resp = Request::post("/api/terminals")
    .json(req)
    .map_err(|e| e.to_string())?
    .send()
    .await
    .map_err(|e| e.to_string())?;
  if !resp.ok() {
    return Err(format!("HTTP {}", resp.status()));
  }
  resp.json().await.map_err(|e| e.to_string())
}

pub async fn list_terminals() -> Result<Vec<Terminal>, String> {
  let resp = Request::get("/api/terminals")
    .send()
    .await
    .map_err(|e| e.to_string())?;
  resp.json().await.map_err(|e| e.to_string())
}

pub async fn kill_terminal(id: &str) -> Result<(), String> {
  let resp = Request::delete(&format!("/api/terminals/{}", id))
    .send()
    .await
    .map_err(|e| e.to_string())?;
  if !resp.ok() {
    return Err(format!("HTTP {}", resp.status()));
  }
  Ok(())
}
