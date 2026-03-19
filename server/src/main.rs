use axum::{routing::get, Router};
use std::net::SocketAddr;
use tower_http::services::ServeDir;

async fn health() -> &'static str {
    kolu_common::hello()
}

#[tokio::main]
async fn main() {
    let client_dist =
        std::env::var("KOLU_CLIENT_DIST").unwrap_or_else(|_| "../client/dist".to_string());

    let app = Router::new()
        .route("/api/health", get(health))
        .fallback_service(ServeDir::new(client_dist));

    let port: u16 = std::env::var("KOLU_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(7681);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!("listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
