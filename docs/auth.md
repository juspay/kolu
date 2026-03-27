# Exposing Kolu over HTTPS

## Goal

Serve Kolu over HTTPS so that PWA works properly (no self-signed cert warnings, installs as app on Android). Restrict access to authorized users.

## Approach: Tailscale Serve

Tailscale Serve exposes Kolu to the tailnet with automatic HTTPS — zero Kolu code changes, no auth layer needed.

```
Browser (on tailnet) → Tailscale Serve (HTTPS) → Kolu (127.0.0.1:7681)
```

- **HTTPS**: Auto-provisioned Let's Encrypt certs for `machine.tailnet.ts.net`
- **Auth**: Implicit — only tailnet devices can connect
- **WebSockets**: Proxied transparently
- **PWA**: Works — valid HTTPS cert, no warnings, installs on Android

### NixOS Configuration

Declarative `services.tailscale.serve` is available on nixos-unstable (merged [nixpkgs#482230](https://github.com/NixOS/nixpkgs/pull/482230), shipping in 26.05):

```nix
services.tailscale.serve = {
  enable = true;
  services.kolu.endpoints = {
    "tcp:443" = "http://localhost:7681";
  };
};
```

Kolu binds to localhost only:

```nix
services.kolu = {
  host = "127.0.0.1";
  port = 7681;
};
```

Access at `https://machine.tailnet.ts.net`.

### What Changes in Kolu

Nothing. Kolu is unchanged. Tailscale handles TLS and access control externally.

## Alternative: OAuth2 Proxy (public internet)

If Kolu needs to be accessible outside the tailnet (e.g., from devices not running Tailscale), use [oauth2-proxy](https://oauth2-proxy.github.io/oauth2-proxy/) with GitHub OAuth behind a TLS-terminating reverse proxy.

```
Browser → Caddy (TLS/ACME) → oauth2-proxy → Kolu (127.0.0.1:7681)
```

### Auth Flow

1. User opens `https://kolu.example.com`
2. oauth2-proxy: no session cookie → redirect to GitHub OAuth
3. User authorizes on GitHub → redirected back with code
4. oauth2-proxy: exchanges code, validates user, sets encrypted session cookie
5. Proxies request to Kolu on localhost
6. Browser loads SPA, manifest, service worker — all with valid cookie
7. WebSocket upgrade to `/rpc/ws` — cookie sent on upgrade, validated by oauth2-proxy

Cookie-based auth is PWA-safe. oauth2-proxy proxies WebSockets by default (`proxy_websockets = true`). No route whitelisting needed — all routes require auth.

### NixOS Configuration

```nix
# oauth2-proxy
services.oauth2-proxy = {
  enable = true;
  provider = "github";
  clientID = "...";
  clientSecretFile = "/run/secrets/oauth2-proxy-client-secret";
  cookie.secretFile = "/run/secrets/oauth2-proxy-cookie-secret";
  email.addresses = "you@example.com";
  upstream = "http://127.0.0.1:7681";
};

# Caddy — TLS termination
services.caddy = {
  enable = true;
  virtualHosts."kolu.example.com".extraConfig = ''
    reverse_proxy localhost:4180
  '';
};

# Kolu — localhost only
services.kolu = {
  host = "127.0.0.1";
  port = 7681;
};
```

### GitHub OAuth App Setup

1. GitHub → Settings → Developer settings → OAuth Apps → New
2. Callback URL: `https://kolu.example.com/oauth2/callback`
3. Store client ID and secret in deployment secrets

### Tailscale Funnel variant

Funnel can replace Caddy (handles TLS/ACME, exposes to public internet) but **has no auth** — still requires oauth2-proxy. Restricted to ports 443, 8443, 10000.

## Future Extensions

- **Multi-user**: oauth2-proxy passes `X-Forwarded-User` header; Tailscale Serve supports `tailscale whois` on connecting IPs — either enables per-user terminal isolation
- **Org/team restriction**: oauth2-proxy supports `--github-org` and `--github-team` flags
- **Additional providers**: Google, OIDC, etc. — swap provider config, no Kolu changes
