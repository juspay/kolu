mod api;
mod pty;
mod state;
mod terminal;
mod ws;

use axum::routing::get;
use axum::Router;
use clap::Parser;
use std::net::SocketAddr;
use tower_http::services::ServeDir;
use utoipa::OpenApi;
use utoipa_axum::router::OpenApiRouter;
use utoipa_swagger_ui::SwaggerUi;

use state::AppState;

#[derive(Parser)]
#[command(name = "kolu-server")]
struct Args {
  #[arg(long, default_value = "0.0.0.0")]
  host: String,
  #[arg(long, default_value = "7681")]
  port: u16,
}

async fn health() -> &'static str {
  kolu_common::hello()
}

#[derive(OpenApi)]
#[openapi(
  info(title = "kolu API", version = "0.1.0"),
  components(schemas(
    kolu_common::Terminal,
    kolu_common::TerminalStatus,
    kolu_common::CreateTerminalRequest,
  ))
)]
struct ApiDoc;

#[tokio::main]
async fn main() {
  tracing_subscriber::fmt::init();

  let args = Args::parse();
  let client_dist =
    std::env::var("KOLU_CLIENT_DIST").unwrap_or_else(|_| "../client/dist".to_string());

  let state = AppState::new();

  // Status sweep: update Running/Idle/Exited every 2s
  let sweep_state = state.clone();
  tokio::spawn(async move {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(2));
    loop {
      interval.tick().await;
      terminal::sweep_status(&sweep_state);
    }
  });

  let (api_router, api) = OpenApiRouter::with_openapi(ApiDoc::openapi())
    .route("/api/health", get(health))
    .routes(utoipa_axum::routes!(
      api::create_terminal,
      api::list_terminals
    ))
    .routes(utoipa_axum::routes!(api::kill_terminal))
    .split_for_parts();

  let app = Router::new()
    .merge(api_router)
    .merge(SwaggerUi::new("/swagger-ui").url("/api-docs/openapi.json", api))
    .route("/ws/{terminal_id}", get(ws::ws_handler))
    .with_state(state)
    .fallback_service(ServeDir::new(client_dist));

  let addr: SocketAddr = format!("{}:{}", args.host, args.port).parse().unwrap();
  tracing::info!(%addr, "listening");
  let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
  axum::serve(listener, app).await.unwrap();
}
