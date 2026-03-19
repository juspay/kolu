mod terminal;
mod terminal_view;

use leptos::prelude::*;
use terminal_view::{TerminalView, WsStatus};

fn main() {
    console_error_panic_hook::set_once();
    leptos::mount::mount_to_body(App);
}

#[component]
fn App() -> impl IntoView {
    let (ws_status, set_ws_status) = signal(WsStatus::Connecting);

    view! {
        <div class="flex flex-col w-full h-screen bg-slate-900">
            // Compact header with branding + WS status
            <header class="flex items-center gap-3 px-4 py-2 bg-slate-800 border-b border-slate-700">
                <img src="/favicon.svg" alt="kolu" class="w-6 h-6" />
                <span class="text-sm font-semibold text-slate-300">{kolu_common::hello()}</span>
                <span class={move || format!("ml-auto text-xs {}", ws_status.get().css_color())}>
                    {move || ws_status.get().label()}
                </span>
            </header>
            // Terminal fills remaining space
            <div class="flex-1 min-h-0 p-2">
                <div class="w-full h-full border border-slate-600 rounded">
                    <TerminalView session_id="default".to_string() set_ws_status=set_ws_status />
                </div>
            </div>
        </div>
    }
}
