mod bridge;
mod header;
mod terminal;
mod terminal_view;
mod ws;

use leptos::prelude::*;

use header::Header;
use terminal_view::TerminalView;
use ws::WsStatus;

fn main() {
  console_error_panic_hook::set_once();
  leptos::mount::mount_to_body(App);
}

#[component]
fn App() -> impl IntoView {
  let (ws_status, set_ws_status) = signal(WsStatus::Connecting);

  view! {
      <div class="flex flex-col w-full h-screen bg-slate-900">
          <Header ws_status=ws_status />
          <div class="flex-1 min-h-0 p-2">
              <div class="w-full h-full border border-slate-600 rounded">
                  <TerminalView session_id="default".to_string() set_ws_status=set_ws_status />
              </div>
          </div>
      </div>
  }
}
