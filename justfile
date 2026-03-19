# Prefix for commands that need a Nix devshell; empty if already inside one.
nix_shell := if env('IN_NIX_SHELL', '') != '' { '' } else { 'nix develop -c' }

# List available recipes
default:
    @just --list

# Run server + client in parallel via process-compose
dev:
    nix run .#dev

# Run server with cargo watch (auto-reload)
server:
    cd server && {{nix_shell}} cargo watch -x run

# Run client with trunk serve (WASM hot-reload)
client:
    cd client && {{nix_shell}} trunk serve

# Run Playwright e2e tests
test:
    cd tests \
        && {{nix_shell}} npm install \
        && {{nix_shell}} npx playwright test

# Run Playwright e2e tests with interactive UI
test-ui:
    cd tests \
        && {{nix_shell}} npm install \
        && {{nix_shell}} npx playwright test --ui

# Nix build (server + client WASM)
build:
    nix build

# Run the combined server+client binary
run:
    nix run
