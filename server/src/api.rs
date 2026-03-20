use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use kolu_common::*;

use crate::state::AppState;
use crate::terminal;

/// Create a new terminal with auto-generated ID.
#[utoipa::path(
  post,
  path = "/api/terminals",
  request_body = CreateTerminalRequest,
  responses(
    (status = 200, description = "Terminal created", body = Terminal),
    (status = 500, description = "Failed to spawn PTY"),
  )
)]
pub async fn create_terminal(
  State(state): State<AppState>,
  Json(req): Json<CreateTerminalRequest>,
) -> Result<Json<Terminal>, StatusCode> {
  terminal::create(&state, req).map(Json)
}

/// List all terminals with current status.
#[utoipa::path(
  get,
  path = "/api/terminals",
  responses(
    (status = 200, description = "List of terminals", body = Vec<Terminal>),
  )
)]
pub async fn list_terminals(State(state): State<AppState>) -> Json<Vec<Terminal>> {
  Json(terminal::list(&state))
}

/// Kill and remove a terminal by ID.
#[utoipa::path(
  delete,
  path = "/api/terminals/{id}",
  params(
    ("id" = String, Path, description = "Terminal ID"),
  ),
  responses(
    (status = 204, description = "Terminal killed"),
    (status = 404, description = "Terminal not found"),
  )
)]
pub async fn kill_terminal(
  State(state): State<AppState>,
  Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
  terminal::kill(&state, &id)?;
  Ok(StatusCode::NO_CONTENT)
}
