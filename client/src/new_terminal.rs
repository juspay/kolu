//! Inline form for creating a new terminal.

use leptos::prelude::*;

use kolu_common::CreateTerminalRequest;

/// Form with ID, label, and optional command fields.
#[component]
pub fn NewTerminalForm(
  #[prop(into)] on_create: Callback<CreateTerminalRequest>,
  #[prop(into)] on_cancel: Callback<()>,
) -> impl IntoView {
  let (id, set_id) = signal(String::new());
  let (label, set_label) = signal(String::new());
  let (command, set_command) = signal(String::new());
  let (error, set_error) = signal(Option::<String>::None);

  let submit = move |e: web_sys::SubmitEvent| {
    e.prevent_default();
    let id_val = id.get_untracked();
    let label_val = label.get_untracked();
    if id_val.trim().is_empty() || label_val.trim().is_empty() {
      set_error.set(Some("ID and label are required".to_string()));
      return;
    }
    set_error.set(None);
    let req = CreateTerminalRequest {
      id: id_val,
      label: label_val,
      command: {
        let c = command.get_untracked();
        if c.trim().is_empty() {
          None
        } else {
          Some(vec![c])
        }
      },
    };
    on_create.run(req);
  };

  view! {
    <form
      class="p-3 border-b border-slate-700 space-y-2"
      on:submit=submit
    >
      <div>
        <input
          type="text"
          placeholder="ID"
          class="w-full px-2 py-1 text-sm bg-slate-900 border border-slate-600 rounded text-slate-200 placeholder-slate-500"
          on:input=move |e| set_id.set(event_target_value(&e))
          prop:value=id
        />
      </div>
      <div>
        <input
          type="text"
          placeholder="Label"
          class="w-full px-2 py-1 text-sm bg-slate-900 border border-slate-600 rounded text-slate-200 placeholder-slate-500"
          on:input=move |e| set_label.set(event_target_value(&e))
          prop:value=label
        />
      </div>
      <div>
        <input
          type="text"
          placeholder="Command (default: shell)"
          class="w-full px-2 py-1 text-sm bg-slate-900 border border-slate-600 rounded text-slate-200 placeholder-slate-500"
          on:input=move |e| set_command.set(event_target_value(&e))
          prop:value=command
        />
      </div>
      {move || error.get().map(|e| view! {
        <p class="text-xs text-red-400">{e}</p>
      })}
      <div class="flex gap-2">
        <button
          type="submit"
          class="flex-1 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded"
        >"Create"</button>
        <button
          type="button"
          class="flex-1 px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded"
          on:click=move |_| on_cancel.run(())
        >"Cancel"</button>
      </div>
    </form>
  }
}
