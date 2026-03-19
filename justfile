# List available recipes
default:
    @just --list

# Run server + client in parallel via process-compose
dev:
    nix run .#dev

# Run server with cargo watch (auto-reload)
server:
    cd server && cargo watch -x run

# Run client with trunk serve (WASM hot-reload)
client:
    cd client && trunk serve

# Run Playwright e2e tests
test:
    cd tests && npm install && npx playwright test

# Nix build (server + client WASM)
build:
    nix build

# Run the combined server+client binary
run:
    nix run
