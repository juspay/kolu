//! Modal dialog for creating a new terminal.

use leptos::prelude::*;

use kolu_common::{CreateTerminalRequest, TerminalCommand};

/// Modal overlay with command dropdown and optional working directory.
#[component]
pub fn NewTerminalDialog(
  #[prop(into)] on_create: Callback<CreateTerminalRequest>,
  #[prop(into)] on_cancel: Callback<()>,
) -> impl IntoView {
  let (command, set_command) = signal(TerminalCommand::Shell);
  let (cwd, set_cwd) = signal(String::new());

  let submit = move |e: web_sys::SubmitEvent| {
    e.prevent_default();
    let cwd_val = cwd.get_untracked();
    on_create.run(CreateTerminalRequest {
      command: command.get_untracked(),
      cwd: if cwd_val.trim().is_empty() {
        None
      } else {
        Some(cwd_val)
      },
    });
  };

  let input_class = "w-full px-3 py-2 text-sm bg-slate-900 border border-slate-600 rounded text-slate-200";

  view! {
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      on:click=move |_| on_cancel.run(())
    >
      <div
        class="w-80 bg-slate-800 border border-slate-600 rounded-lg shadow-xl p-4 space-y-3"
        on:click=move |e: web_sys::MouseEvent| e.stop_propagation()
      >
        <h2 class="text-sm font-semibold text-slate-300">"New Terminal"</h2>
        <form class="space-y-3" on:submit=submit>
          <div>
            <label class="block text-xs text-slate-400 mb-1">"Command"</label>
            <select
              class=input_class
              on:change=move |e| {
                let val = event_target_value(&e);
                set_command.set(match val.as_str() {
                  "Opencode" => TerminalCommand::Opencode,
                  "Claude" => TerminalCommand::Claude,
                  _ => TerminalCommand::Shell,
                });
              }
            >
              <option value="Shell" selected=true>"shell"</option>
              <option value="Opencode">"opencode"</option>
              <option value="Claude">"claude"</option>
            </select>
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1">"Working Directory"</label>
            <input
              type="text"
              placeholder="Default: $HOME"
              class=input_class
              on:input=move |e| set_cwd.set(event_target_value(&e))
              prop:value=cwd
            />
          </div>
          <div class="flex gap-2 pt-1">
            <button
              type="button"
              class="flex-1 px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 rounded"
              on:click=move |_| on_cancel.run(())
            >"Cancel"</button>
            <button
              type="submit"
              class="flex-1 px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded"
            >"Create"</button>
          </div>
        </form>
      </div>
    </div>
  }
}
