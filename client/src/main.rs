use leptos::prelude::*;

fn main() {
    leptos::mount::mount_to_body(App);
}

#[component]
fn App() -> impl IntoView {
    view! {
        <div class="min-h-screen bg-slate-900 text-slate-200 flex items-center justify-center">
            <h1 class="text-4xl font-bold">{kolu_common::hello()}</h1>
        </div>
    }
}
