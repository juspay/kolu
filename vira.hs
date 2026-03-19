-- Pipeline configuration for Vira <https://vira.nixos.asia/>

\ctx pipeline ->
  let
    isMain = ctx.branch == "master"
  in
  pipeline
    { build.systems =
        [ "x86_64-linux"
        ]
    , signoff.enable = True
    , cache.url = if
        | isMain -> Just "https://cache.nixos.asia/oss"
        | otherwise -> Nothing
    }
