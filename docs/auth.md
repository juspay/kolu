# Authentication via OAuth2 Proxy

## Goal

Publicly expose Kolu over HTTPS so that PWA works properly (no self-signed cert warnings, installs as app on Android). Authentication prevents unauthorized access to terminals.

## Approach

External auth via [oauth2-proxy](https://oauth2-proxy.github.io/oauth2-proxy/) — zero Kolu code changes. Auth lives entirely in the NixOS deployment layer.

## Architecture

```
Browser → Caddy (TLS/ACME) → oauth2-proxy → Kolu (127.0.0.1:7681)
```

- **Caddy**: TLS termination via automatic ACME certificates
- **oauth2-proxy**: GitHub OAuth, cookie-based sessions
- **Kolu**: Binds to localhost only, unchanged

## Auth Flow

1. User opens `https://kolu.example.com`
2. oauth2-proxy: no session cookie → redirect to GitHub OAuth
3. User authorizes on GitHub → redirected back with code
4. oauth2-proxy: exchanges code for token, validates user, sets encrypted session cookie
5. Proxies request to Kolu on localhost
6. Browser loads SPA, manifest, service worker — all with valid cookie
7. WebSocket upgrade to `/rpc/ws` — cookie sent on upgrade request, validated by oauth2-proxy before proxying

## PWA Compatibility

Cookie-based auth is PWA-safe. The manifest, service worker, and all assets are fetched _after_ the OAuth flow completes — the browser already has a valid session cookie by the time it requests them.

## WebSocket Support

oauth2-proxy proxies WebSockets by default (`proxy_websockets = true`). The WS upgrade is a standard HTTP request that goes through the full auth middleware chain. No special configuration needed.

## Route Whitelisting

Only health check needs anonymous access:

```
--skip-auth-route="^/api/health$"
```

All other routes (static assets, RPC, WebSocket) require auth. Users are redirected to GitHub before any app content is served.

## NixOS Configuration

### oauth2-proxy

```nix
services.oauth2-proxy = {
  enable = true;
  provider = "github";
  clientID = "...";
  clientSecretFile = "/run/secrets/oauth2-proxy-client-secret";
  cookie.secretFile = "/run/secrets/oauth2-proxy-cookie-secret";
  email.addresses = "you@example.com";  # restrict to your account
  upstream = "http://127.0.0.1:7681";
  extraConfig = {
    skip-auth-route = "^/api/health$";
  };
};
```

### Caddy

```nix
services.caddy = {
  enable = true;
  virtualHosts."kolu.example.com".extraConfig = ''
    reverse_proxy localhost:4180  # oauth2-proxy default port
  '';
};
```

### Kolu

```nix
services.kolu = {
  host = "127.0.0.1";  # localhost only — Caddy/oauth2-proxy handle public traffic
  port = 7681;
};
```

## GitHub OAuth App Setup

1. GitHub → Settings → Developer settings → OAuth Apps → New
2. Application name: Kolu
3. Homepage URL: `https://kolu.example.com`
4. Callback URL: `https://kolu.example.com/oauth2/callback`
5. Store client ID and secret in deployment secrets

## What Changes in Kolu

Nothing. The entire auth stack is external. Kolu continues to bind to localhost and serve all routes without auth, trusting that only authenticated traffic reaches it via the proxy chain.

## Future Extensions

- **Multi-user**: oauth2-proxy can pass `X-Forwarded-User` header — Kolu could read it for per-user terminal isolation
- **Org/team restriction**: oauth2-proxy supports `--github-org` and `--github-team` flags
- **Additional providers**: Google, OIDC, etc. — swap provider config, no Kolu changes
