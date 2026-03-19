default:
    @just --list

dev:
    nix run .#dev

server:
    cd server && cargo watch -x run

client:
    cd client && trunk serve

test:
    cd tests && npm install && npx playwright test

build:
    nix build

run:
    nix run
