{
  description = "DeepSeek Harness plugins by langify, as @langify-org/dsh-*";

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
      # The plugins build with this flake's own nixpkgs, whatever the caller's: the
      # dependency hash is the store of its pnpm.
      pinnedFor = pkgs: nixpkgs.legacyPackages.${pkgs.stdenv.hostPlatform.system};
      workspaceFor = pkgs: (pinnedFor pkgs).callPackage ./nix/plugins.nix { };
    in
    {
      lib = {
        /**
          Build every plugin of this repository, for the system of `pkgs`.

          Without `dshNodeModules`, each attribute is the plain build: the plugin's
          npm tarball, for `dsh plugin add` or the Plugins page's "Add plugin", and
          the same package unpacked under lib/dsh-plugins/<dir>. With it, each plugin
          that loads with `dsh --patch` is wired to that DSH installation and has a
          `patch` attribute for it. dsh-chrome does not: its generated patch names
          its package, which DSH finds only installed in a profile.

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
            plugins = (workspaceFor pkgs).plugins;
            forDsh = (pinnedFor pkgs).callPackage ./nix/with-dsh.nix { };
          in
          if dshNodeModules == null then
            plugins
          else
            builtins.mapAttrs (_: plugin: forDsh { inherit plugin dshNodeModules; }) (
              nixpkgs.lib.filterAttrs (_: plugin: plugin.loadsWithPatch) plugins
            );
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

      # Building a plugin runs its type checks, tests and a load check; `workspace` runs
      # the lint, the README check, and every package's type checks and tests.
      checks = forAllSystems (
        pkgs: self.lib.mkPlugins { inherit pkgs; } // { workspace = (workspaceFor pkgs).check; }
      );

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          # Node 24 runs the TypeScript sources directly (type stripping); pnpm matches
          # the `packageManager` field of the root package.json.
          packages = [
            pkgs.nodejs_24
            pkgs.pnpm_12
            pkgs.just
            pkgs.git
          ]
          # dsh-chrome runs Chrome on a screen TigerVNC's Xvnc serves, with Openbox as
          # its window manager; `pnpm dev` and its integration tests need both.
          ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [
            pkgs.tigervnc
            pkgs.openbox
          ];
        };
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt);
    };
}
