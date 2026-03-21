{ inputs, ... }:
{
  imports = [
    inputs.process-compose-flake.flakeModule
  ];
  perSystem = {
    process-compose."kolu-dev" = {
      cli.environment.PC_DISABLE_TUI = true;
      cli.options.port = 0; # Disable HTTP server
      settings = {
        processes = {
          server.command = "cd server && pnpm dev";
          client = {
            command = "cd client && pnpm dev";
            is_tty = true;
          };
        };
      };
    };
  };
}
