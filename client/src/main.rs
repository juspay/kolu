mod api;
mod bridge;
mod header;
mod new_terminal;
mod sidebar;
mod terminal;
mod terminal_view;

use leptos::prelude::*;
use wasm_bindgen::prelude::*;

use header::Header;
use kolu_common::{CreateTerminalRequest, Terminal, TerminalId};
use new_terminal::NewTerminalDialog;
use sidebar::Sidebar;
use terminal_pane::TerminalPane;

mod terminal_pane;

fn main() {
  console_error_panic_hook::set_once();
  leptos::mount::mount_to_body(App);
}

/// Root component: sidebar + terminal pane with polling and terminal switching.
#[component]
fn App() -> impl IntoView {
  let (terminals, set_terminals) = signal(Vec::<Terminal>::new());
  let (active_id, set_active_id) = signal(Option::<TerminalId>::None);
  let (show_dialog, set_show_dialog) = signal(false);

  // Poll terminal list: fire immediately, then every 3s
  {
    let fetch_terminals = Closure::wrap(Box::new(move || {
      wasm_bindgen_futures::spawn_local(async move {
        if let Ok(list) = api::list_terminals().await {
          set_terminals.set(list);
        }
      });
    }) as Box<dyn FnMut()>);

    fetch_terminals
      .as_ref()
      .unchecked_ref::<js_sys::Function>()
      .call0(&JsValue::NULL)
      .unwrap();
    let window = web_sys::window().unwrap();
    let _ = window.set_interval_with_callback_and_timeout_and_arguments_0(
      fetch_terminals.as_ref().unchecked_ref(),
      3000,
    );
    fetch_terminals.forget();
  }

  let on_select = Callback::new(move |id: TerminalId| {
    set_active_id.set(Some(id));
  });

  let on_new = Callback::new(move |_: ()| {
    set_show_dialog.set(true);
  });

  let on_create = Callback::new(move |req: CreateTerminalRequest| {
    set_show_dialog.set(false);
    wasm_bindgen_futures::spawn_local(async move {
      match api::create_terminal(&req).await {
        Ok(t) => {
          set_active_id.set(Some(t.id));
          if let Ok(list) = api::list_terminals().await {
            set_terminals.set(list);
          }
        }
        Err(e) => {
          web_sys::console::error_1(&format!("Failed to create terminal: {}", e).into());
        }
      }
    });
  });

  let on_cancel = Callback::new(move |_: ()| {
    set_show_dialog.set(false);
  });

  let on_kill = Callback::new(move |id: TerminalId| {
    wasm_bindgen_futures::spawn_local(async move {
      let _ = api::kill_terminal(&id).await;
    });
  });

  view! {
    <div class="flex flex-col w-full h-screen bg-slate-900">
      <Header />
      <div class="flex flex-1 min-h-0">
        <div class="flex flex-col">
          <Sidebar
            terminals=terminals
            active_id=active_id
            on_select=on_select
            on_new=on_new
            on_kill=on_kill
          />
        </div>
        <div class="flex-1 min-w-0 min-h-0 p-2 overflow-hidden">
          <TerminalPane active_id=active_id terminals=terminals />
        </div>
      </div>
      {move || show_dialog.get().then(|| view! {
        <NewTerminalDialog on_create=on_create on_cancel=on_cancel />
      })}
    </div>
  }
}
