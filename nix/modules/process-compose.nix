{ inputs, ... }:
{
  imports = [
    inputs.process-compose-flake.flakeModule
  ];
  perSystem = {
    process-compose."dev" = {
      cli.environment.PC_DISABLE_TUI = true;
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
