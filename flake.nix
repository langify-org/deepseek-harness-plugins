{
  description = "Plugins for DeepSeek Harness (DSH)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

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
      workspaceFor = pkgs: pkgs.callPackage ./nix/workspace.nix { };
    in
    {
      # One package per plugin, named by its directory: its npm tarball, for DSH's
      # "Add plugin".
      packages = forAllSystems (pkgs: (workspaceFor pkgs).plugins);

      # Building a plugin runs the workspace's lint, type checks and tests.
      checks = forAllSystems (pkgs: self.packages.${pkgs.stdenv.hostPlatform.system});

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          # Node 24 runs the TypeScript sources directly (type stripping); pnpm matches
          # the `packageManager` field of the root package.json.
          packages = [
            pkgs.nodejs_24
            pkgs.pnpm_12
          ]
          # The integration tests start Chrome on a private X display.
          ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.xvfb ];
        };
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt);
    };
}
