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

# Run e2e tests locally and post signoff status to GitHub
ci:
    #!/usr/bin/env bash
    set -euo pipefail
    # Bail if worktree is dirty
    if [ -n "$(git status --porcelain)" ]; then
        echo "✗ Dirty worktree. Commit or stash changes first."
        exit 1
    fi
    REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
    SHA=$(git rev-parse HEAD)
    USER=$(gh api user -q .login)
    CONTEXT="signoff/e2e"
    # Post pending status
    echo "⏳ Posting pending status for $CONTEXT..."
    gh api "repos/$REPO/statuses/$SHA" \
        -f state=pending -f context="$CONTEXT" \
        -f description="Running e2e tests locally (by $USER)..." > /dev/null
    # On Ctrl+C, just exit without posting failure
    trap 'echo " interrupted"; exit 130' INT
    # Run tests
    if just test; then
        gh api "repos/$REPO/statuses/$SHA" \
            -f state=success -f context="$CONTEXT" \
            -f description="e2e passed (ran by $USER)" > /dev/null
        echo "✓ e2e passed, signoff posted"
    else
        gh api "repos/$REPO/statuses/$SHA" \
            -f state=failure -f context="$CONTEXT" \
            -f description="e2e failed (ran by $USER)" > /dev/null
        echo "✗ e2e failed, failure posted"
        exit 1
    fi

# Nix build (server + client WASM)
build:
    nix build

# Run the combined server+client binary
run:
    nix run
