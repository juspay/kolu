{ inputs, ... }:
{
  imports = [
    inputs.process-compose-flake.flakeModule
  ];
  perSystem = { config, pkgs, lib, ... }: {
    process-compose."dev" = {
      cli.environment.PC_DISABLE_TUI = true;
      settings = {
        processes = {
          server.command = "cd server && cargo watch -x run";
          client = {
            # Build first so missing deps (npm) fail fast instead of
            # trunk silently serving an empty site.
            command = "cd client && npm install && trunk build && trunk serve";
            is_tty = true;
          };
        };
      };
    };
  };
}
