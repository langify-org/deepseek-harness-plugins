# The pnpm workspace as Nix sees it: its sources, its dependency store, and a builder
# that turns one plugin package into the npm tarball DSH installs.
{
  lib,
  stdenv,
  autoPatchelfHook,
  nodejs_24,
  pnpm_12,
  fetchPnpmDeps,
  pnpmConfigHook,
}:
let
  pnpm = pnpm_12;

  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../package.json
      ../pnpm-lock.yaml
      ../pnpm-workspace.yaml
      ../tsconfig.base.json
      ../biome.jsonc
      # Biome reads the ignore file to skip build output.
      ../.gitignore
      ../plugins
      ../tooling
    ];
  };

  # One store for the whole workspace: every plugin shares the lock file.
  # After changing dependencies, set the hash to "" and build; the error reports the new
  # one. (Under the old hash, Nix keeps the old store and the build fails offline.)
  pnpmDeps = fetchPnpmDeps {
    pname = "deepseek-harness-plugins";
    version = "0";
    inherit src pnpm;
    fetcherVersion = 4;
    hash = "sha256-qLfzPvwZdu/k08UVYnBBD3PVie0A7l0pWstkuJAJukY=";
  };

  # Builds a plugin after the workspace-wide lint, type checks and the plugin's tests
  # pass, and packs it as its npm tarball. Tests that need a real Chrome are not run here.
  buildPlugin =
    { directory }:
    let
      manifest = lib.importJSON (../plugins + "/${directory}/package.json");
      # npm's tarball name for a scoped package: @scope/name → scope-name-version.tgz.
      tarballName = "${lib.replaceStrings [ "@" "/" ] [ "" "-" ] manifest.name}-${manifest.version}.tgz";
    in
    stdenv.mkDerivation {
      pname = lib.last (lib.splitString "/" manifest.name);
      inherit (manifest) version;
      inherit src pnpmDeps;
      nativeBuildInputs = [
        nodejs_24
        pnpm
        pnpmConfigHook
      ]
      ++ lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];
      # Biome's npm binary is linked for a conventional Linux; give it this store's libraries.
      buildInputs = lib.optionals stdenv.hostPlatform.isLinux [ stdenv.cc.cc.lib ];
      dontAutoPatchelf = true;
      patchNativeTools = lib.optionalString stdenv.hostPlatform.isLinux ''
        for biome in node_modules/.pnpm/@biomejs+cli-linux-*/node_modules/@biomejs/cli-linux-*/biome; do
          chmod u+w "$biome"
          autoPatchelf "$biome"
        done
      '';

      buildPhase = ''
        runHook preBuild
        eval "$patchNativeTools"
        pnpm run lint
        pnpm run typecheck
        pnpm run test
        pnpm --filter ${manifest.name} run build
        runHook postBuild
      '';

      doCheck = true;
      checkPhase = ''
        runHook preCheck
        pnpm --filter ${manifest.name} --if-present run test:compat
        runHook postCheck
      '';

      installPhase = ''
        runHook preInstall
        mkdir -p "$out"
        (cd plugins/${directory} && pnpm pack --pack-destination "$out")
        runHook postInstall
      '';

      passthru.tarball = tarballName;

      meta = {
        inherit (manifest) description;
        license = lib.licenses.mit;
      };
    };
in
{
  inherit src pnpmDeps buildPlugin;
}
