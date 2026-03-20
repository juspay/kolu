{ pkgs, ... }:
{
  autoWire = [ "crate" "clippy" ];
  crane.args = {
    # utoipa-swagger-ui downloads Swagger UI assets at build time via curl.
    nativeBuildInputs = [ pkgs.curl ];
  };
}
