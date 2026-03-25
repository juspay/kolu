# Nix derivation that fetches and bundles all web font assets.
# Inter (variable weight 400–600) from Google Fonts, FiraCode Nerd Font from nerdfont-webfonts.
{ pkgs }:
let
  fetchFont = name: url: hash:
    pkgs.fetchurl { inherit url hash; inherit name; };

  inter = subset: url: hash:
    fetchFont "inter-${subset}.woff2" url hash;

  fonts = [
    (inter "latin" "https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2"
      "sha256-MQDndehhbNJhG+7PojpCY9cDdYZ4m0PwNSNqLm+9TGI=")
    (inter "latin-ext" "https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa25L7SUc.woff2"
      "sha256-NLnFBMq3pz43t0Y0OkSRMuVs97VIGvLLgdx03P8lyVY=")
    (inter "cyrillic" "https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa0ZL7SUc.woff2"
      "sha256-cdXuk8wenx1SCjqLZkVt4Yx4edjfCdV/zS6v91/vAHU=")
    (inter "cyrillic-ext" "https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa2JL7SUc.woff2"
      "sha256-yhVwYzOaxK1BjyFPOr/tEZsHmKtNN3OGzlyeWnpDXr0=")
    (inter "greek" "https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1pL7SUc.woff2"
      "sha256-G+NEjikvvwX/4Xb+HkPxNQE9ULHn0yStGlWPYj07tvY=")
    (inter "greek-ext" "https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa2ZL7SUc.woff2"
      "sha256-bp4CCiX5tW1BjywIWx08CXJaTaI/5pOltGMGRgZzIZA=")
    (inter "vietnamese" "https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa2pL7SUc.woff2"
      "sha256-XGb54H6QxtSsSSLMaNYN4mwXsYWOZ3+15gP845UrP/I=")
    (fetchFont "FiraCodeNerdFont-Regular.woff2"
      "https://cdn.jsdelivr.net/gh/mshaugh/nerdfont-webfonts@v3.3.0/build/fonts/FiraCodeNerdFont-Regular.woff2"
      "sha256-71OZLN9GnUAk0u/CnVHAWmVCXRymkOUF+rgCI5gKBn0=")
    (fetchFont "FiraCodeNerdFont-Bold.woff2"
      "https://cdn.jsdelivr.net/gh/mshaugh/nerdfont-webfonts@v3.3.0/build/fonts/FiraCodeNerdFont-Bold.woff2"
      "sha256-7LYtNpPVIeYD1I6Jeb9bdOB2/vOjfnrSPD3l4SMMgzs=")
  ];
in
pkgs.runCommand "kolu-fonts" { } ''
  mkdir -p $out
  ${pkgs.lib.concatMapStringsSep "\n" (f: "cp ${f} $out/${f.name}") fonts}
''
