{
  description = "DeepSeek Harness plugins development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      # The official Node.js build (.node-version, shared with CI), matching the version
      # DSH Desktop bundles. Bumping it means updating the hashes below.
      # nixpkgs' source-built Node cannot boot the DSH host: its internal-module
      # addon (node-addon-require-builtin) recognizes only official binaries.
      nodeVersion = nixpkgs.lib.trim (builtins.readFile ./.node-version);
      nodeDists = {
        x86_64-linux = {
          name = "linux-x64";
          sha256 = "fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6";
        };
        aarch64-linux = {
          name = "linux-arm64";
          sha256 = "6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2";
        };
        x86_64-darwin = {
          name = "darwin-x64";
          sha256 = "0ae5a24c24bb7d015cd816c5036b3f90f2945aa872fcf54e58da054753b3a299";
        };
        aarch64-darwin = {
          name = "darwin-arm64";
          sha256 = "6239d4cf92d864487ec8cd3615038f7b67e7f58b77b21cd2f09ea9fbd68065fe";
        };
      };
      forAllSystems = nixpkgs.lib.genAttrs (builtins.attrNames nodeDists);
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          dist = nodeDists.${system};
          nodejs = pkgs.stdenv.mkDerivation {
            pname = "nodejs-official";
            version = nodeVersion;
            src = pkgs.fetchurl {
              url = "https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-${dist.name}.tar.xz";
              inherit (dist) sha256;
            };
            # Adding an rpath (as autoPatchelf does) makes this binary segfault at
            # startup, so the C++ runtime is linked by absolute path instead.
            dontFixup = true;
            installPhase =
              let
                cclib = "${pkgs.lib.getLib pkgs.stdenv.cc.cc}/lib";
              in
              ''
                cp -r . $out
              ''
              + pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isLinux ''
                ${pkgs.lib.getExe pkgs.patchelf} \
                  --set-interpreter ${pkgs.stdenv.cc.bintools.dynamicLinker} \
                  --replace-needed libstdc++.so.6 ${cclib}/libstdc++.so.6 \
                  --replace-needed libgcc_s.so.1 ${cclib}/libgcc_s.so.1 \
                  $out/bin/node
                $out/bin/node --version
              '';
          };
        in
        {
          default = pkgs.mkShellNoCC {
            packages = [
              nodejs
              # pnpm runs on the node above rather than its own nixpkgs build.
              (pkgs.pnpm_11.override { withNode = false; })
            ];
          };
        }
      );
    };
}
