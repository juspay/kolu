let
  shim = ./shim;
  packageName = "@agentclientprotocol/claude-agent-acp";
in
{
  inherit shim;

  shimName = "kolu-acp-claude";
  package = packageName;

  entry = "dist/index.js";
  bin = "claude-agent-acp";

  version = (builtins.fromJSON (builtins.readFile (shim + "/package.json"))).dependencies.${packageName};

  npmDepsHash = "sha256-+9kyd25sTLvzZElWarbWBPqplLjJqfSse0RIIV4yU2M=";

  patches = ./patches;
}
