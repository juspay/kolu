//! WebSocket handler that bridges browser clients to the PTY.
//!
//! This module is intentionally the "glue" between WebSocket transport
//! and PTY I/O. It doesn't own either concern — it routes messages
//! between them. The PTY lifecycle lives in `pty.rs`; WS framing is
//! handled by axum. This module only does the plumbing.

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Path, State, WebSocketUpgrade};
use axum::response::IntoResponse;
use futures::stream::StreamExt;
use futures::SinkExt;

use kolu_common::WsClientMessage;

use crate::pty::PtyCommand;
use crate::state::AppState;

/// Axum handler: upgrade HTTP to WebSocket for terminal I/O.
/// Route: `GET /ws/:terminal_id`
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Path(_terminal_id): Path<String>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

/// Bidirectional pipe between a WebSocket client and the PTY.
///
/// On connect: replays scrollback so the client sees prior output.
/// Then: PTY output → WS binary frames, WS input → PTY stdin.
async fn handle_socket(socket: WebSocket, state: AppState) {
    let pty = state.pty();
    let (mut ws_tx, mut ws_rx) = socket.split();

    // Replay scrollback so reconnecting clients see history
    let scrollback = pty.scrollback_snapshot();
    if !scrollback.is_empty()
        && ws_tx
            .send(Message::Binary(scrollback.into()))
            .await
            .is_err()
    {
        return;
    }

    // Subscribe to PTY output broadcast AFTER scrollback replay.
    // Small window for lost output — acceptable for Phase 1.
    let mut output_rx = pty.output_tx.subscribe();
    let cmd_tx = pty.cmd_tx.clone();

    // PTY output → WebSocket (binary frames)
    let send_task = tokio::spawn(async move {
        while let Ok(data) = output_rx.recv().await {
            if ws_tx
                .send(Message::Binary(data.to_vec().into()))
                .await
                .is_err()
            {
                break;
            }
        }
    });

    // WebSocket → PTY stdin
    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_rx.next().await {
            match msg {
                // Binary frames: raw terminal input (keystrokes)
                Message::Binary(data) => {
                    let _ = cmd_tx.send(PtyCommand::Write(data.to_vec())).await;
                }
                // Text frames: JSON control messages (e.g. Resize)
                Message::Text(text) => {
                    if let Ok(client_msg) = serde_json::from_str::<WsClientMessage>(&text) {
                        match client_msg {
                            WsClientMessage::Resize { cols, rows } => {
                                let _ = cmd_tx.send(PtyCommand::Resize { cols, rows }).await;
                            }
                        }
                    } else {
                        // Treat unrecognized text as raw input
                        let _ = cmd_tx
                            .send(PtyCommand::Write(text.as_bytes().to_vec()))
                            .await;
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    // Wait for either direction to finish, then clean up
    tokio::select! {
        _ = send_task => {},
        _ = recv_task => {},
    }

    tracing::debug!("WebSocket connection closed");
}
