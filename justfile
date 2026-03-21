# Prefix for commands that need a Nix devshell; empty if already inside one.

nix_shell := if env('IN_NIX_SHELL', '') != '' { '' } else { 'nix develop -c' }

# List available recipes
default:
    @just --list

# Run server + client in parallel via process-compose
dev:
    {{ nix_shell }} nix run .#dev

# Run TypeScript type checking across all packages
watch:
    {{ nix_shell }} pnpm typecheck

# Run server with auto-reload
server:
    cd server && {{ nix_shell }} pnpm dev

# Run client with Vite dev server (HMR)
client:
    cd client && {{ nix_shell }} pnpm dev

# Run Cucumber e2e tests (starts server via nix run)
test:
    cd tests \
        && {{ nix_shell }} pnpm install \
        && {{ nix_shell }} pnpm test

# Run Cucumber e2e tests against an already-running dev server (just dev)
test-dev:
    cd tests \
        && {{ nix_shell }} pnpm install \
        && REUSE_SERVER=1 {{ nix_shell }} pnpm test

# Run full nix build (via vira), e2e tests, and post signoff status to GitHub
ci:
    nix run github:juspay/vira ci
    just signoff signoff/e2e just test

# Post GitHub commit status (pending → success/failure) around any command
signoff context +cmd:
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
    CONTEXT="{{ context }}"
    # Post pending status
    echo "⏳ Posting pending status for $CONTEXT..."
    gh api "repos/$REPO/statuses/$SHA" \
        -f state=pending -f context="$CONTEXT" \
        -f description="Running locally (by $USER)..." > /dev/null
    # On Ctrl+C, just exit without posting failure
    trap 'echo " interrupted"; exit 130' INT
    # Run command
    if {{ cmd }}; then
        gh api "repos/$REPO/statuses/$SHA" \
            -f state=success -f context="$CONTEXT" \
            -f description="Passed (ran by $USER)" > /dev/null
        echo "✓ $CONTEXT passed, signoff posted"
    else
        gh api "repos/$REPO/statuses/$SHA" \
            -f state=failure -f context="$CONTEXT" \
            -f description="Failed (ran by $USER)" > /dev/null
        echo "✗ $CONTEXT failed, failure posted"
        exit 1
    fi

# Run pre-commit hooks on all files
pc:
    {{ nix_shell }} pre-commit run -a

# Nix build (server + client)
build:
    nix build

# Run the combined server+client binary
run:
    nix run
