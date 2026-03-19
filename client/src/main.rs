use leptos::prelude::*;

fn main() {
    leptos::mount::mount_to_body(App);
}

#[component]
fn App() -> impl IntoView {
    view! { <h1>{kolu_common::hello()}</h1> }
}
