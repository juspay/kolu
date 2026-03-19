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
            command = "cd client && trunk serve";
            is_tty = true;
          };
        };
      };
    };
  };
}
