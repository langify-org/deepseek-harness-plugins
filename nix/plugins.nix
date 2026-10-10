# Build every plugin under ../plugins from this pnpm workspace.
#
# Each result holds the published bundle layout under
# $out/lib/dsh-plugins/<dir>: package.json, cordis.patch.yml, lib/, examples/,
# README.md. It is not loadable by itself, because its `@deepseek-ai/*` peers
# must resolve to the DSH installation that loads it; see ./with-dsh.nix.
{
  lib,
  stdenvNoCC,
  nodejs_24,
  pnpm,
  fetchPnpmDeps,
  pnpmConfigHook,
  bash,
}:
let
  # A plugin is a directory with a package.json; one that only holds a design note is not one yet.
  pluginDirs = lib.attrNames (
    lib.filterAttrs (
      name: type: type == "directory" && builtins.pathExists (../plugins + "/${name}/package.json")
    ) (builtins.readDir ../plugins)
  );

  pluginFiles =
    dir:
    map (name: lib.fileset.maybeMissing (../plugins + "/${dir}/${name}")) [
      "package.json"
      "cordis.patch.yml"
      "tsconfig.json"
      "tsconfig.build.json"
      "README.md"
      "README.ja.md"
      "README.zh.md"
      "CHANGELOG.md"
      "LICENSE"
      "src"
      "test"
      "examples"
    ];

  # Only sources; never node_modules or build output from a local checkout.
  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions (
      [
        ../package.json
        ../pnpm-lock.yaml
        ../pnpm-workspace.yaml
        ../tsconfig.base.json
      ]
      ++ lib.concatMap pluginFiles pluginDirs
    );
  };

  # One dependency fetch for the whole workspace. Update the hash after any
  # pnpm-lock.yaml change (see AGENTS.md).
  pnpmDeps = fetchPnpmDeps {
    pname = "langify-dsh-plugins";
    version = "0";
    inherit src pnpm;
    fetcherVersion = 4;
    hash = "sha256-T8H8bt5REuf/oa5Iy/l9vReGS06JFiiOlkz6ELUZ8+E=";
  };

  mkPlugin =
    dir:
    let
      manifest = lib.importJSON (../plugins + "/${dir}/package.json");
    in
    stdenvNoCC.mkDerivation (finalAttrs: {
      pname = lib.replaceStrings [ "@" "/" ] [ "" "-" ] manifest.name;
      inherit (manifest) version;
      inherit src pnpmDeps;

      nativeBuildInputs = [
        nodejs_24
        pnpm
        pnpmConfigHook
      ];
      # The tests run real hook commands through bash.
      nativeCheckInputs = [ bash ];

      buildPhase = ''
        runHook preBuild
        pnpm --filter ./plugins/${dir} run build
        runHook postBuild
      '';

      doCheck = true;
      checkPhase = ''
        runHook preCheck
        pnpm --filter ./plugins/${dir} run typecheck
        pnpm --filter ./plugins/${dir} run test
        runHook postCheck
      '';

      installPhase = ''
        runHook preInstall
        dest="$out/lib/dsh-plugins/${dir}"
        mkdir -p "$dest"
        for entry in package.json cordis.patch.yml lib README.md README.ja.md README.zh.md CHANGELOG.md LICENSE examples; do
          if [ -e "plugins/${dir}/$entry" ]; then cp -r "plugins/${dir}/$entry" "$dest/"; fi
        done
        runHook postInstall
      '';

      # The built entry loads, with its peers resolved from the build's node_modules.
      doInstallCheck = true;
      installCheckPhase = ''
        runHook preInstallCheck
        node --input-type=module -e "
          const plugin = await import('$PWD/plugins/${dir}/lib/index.js')
          if (typeof plugin.apply !== 'function' || typeof plugin.name !== 'string') process.exit(1)
        "
        runHook postInstallCheck
      '';

      passthru = {
        inherit dir;
        # Path of the bundle directory inside this output.
        bundlePath = "lib/dsh-plugins/${dir}";
      };

      meta = {
        description = manifest.description;
        homepage = manifest.homepage;
        license = lib.licenses.mit;
        platforms = lib.platforms.unix;
      };
    });
in
lib.genAttrs pluginDirs mkPlugin
