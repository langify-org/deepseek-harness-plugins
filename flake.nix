{
  description = "DeepSeek Harness plugins published as @langify-org/dsh-*";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      lib = {
        /**
          Build every plugin of this repository.

          Without `dshNodeModules`, each attribute is the plain bundle build.
          With it, each attribute is wired to that DSH installation and has a
          `patch` attribute for `dsh --patch`:

            plugins = dsh-plugins.lib.mkPlugins {
              inherit pkgs;
              dshNodeModules = "${deepseekHarness}/lib/deepseek-harness/node_modules";
            };
            # dsh web --patch ${plugins.session-hooks.patch} --patch ${myHookConfig}
        */
        mkPlugins =
          {
            pkgs,
            dshNodeModules ? null,
          }:
          let
            plugins = pkgs.callPackages ./nix/plugins.nix { };
            forDsh = pkgs.callPackage ./nix/with-dsh.nix { };
          in
          if dshNodeModules == null then
            plugins
          else
            builtins.mapAttrs (_: plugin: forDsh { inherit plugin dshNodeModules; }) plugins;
      };

      packages = forAllSystems (
        pkgs:
        let
          plugins = self.lib.mkPlugins { inherit pkgs; };
        in
        plugins
        // {
          default = pkgs.symlinkJoin {
            name = "langify-dsh-plugins";
            paths = builtins.attrValues plugins;
          };
        }
      );

      # Building a plugin runs its type check, tests, and a load check.
      checks = forAllSystems (pkgs: self.lib.mkPlugins { inherit pkgs; });

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_24
            pkgs.pnpm
            pkgs.just
            pkgs.git
          ];
        };
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt);
    };
}
