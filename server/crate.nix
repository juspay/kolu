{ pkgs, ... }:
let
  # Pre-fetch Swagger UI zip so utoipa-swagger-ui doesn't need network at build time.
  swaggerUiZip = pkgs.fetchurl {
    url = "https://github.com/swagger-api/swagger-ui/archive/refs/tags/v5.17.14.zip";
    hash = "sha256-SBJE0IEgl7Efuu73n3HZQrFxYX+cn5UU5jrL4T5xzNw=";
  };
in
{
  autoWire = [ "crate" "clippy" ];
  crane.args = {
    SWAGGER_UI_DOWNLOAD_URL = "file://${swaggerUiZip}";
  };
}
