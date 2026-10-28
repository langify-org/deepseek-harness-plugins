# The pnpm workspace as Nix sees it: its sources, its dependency store, every plugin
# under ../plugins, and the check of the whole workspace.
#
# A plugin's result holds its npm tarball, which DSH installs (`dsh plugin add`, the
# Plugins page's "Add plugin"), and the same package unpacked under lib/dsh-plugins/<dir>.
# A plugin whose own cordis.patch.yml names its entry relative to itself (session-hooks)
# also loads from that unpacked package with `dsh --patch`, once its `@deepseek-ai/*` peers
# resolve to the DSH installation that loads it; see ./with-dsh.nix. A patch that
# dsh-plugin-build generates names the package itself, which DSH resolves among the
# plugins installed in the profile, so such a plugin (dsh-chrome) loads only installed.
{
  lib,
  stdenv,
  stdenvNoCC,
  autoPatchelfHook,
  nodejs_24,
  pnpm_12,
  fetchPnpmDeps,
  pnpmConfigHook,
  bash,
}:
let
  # The version the root package.json's `packageManager` names.
  pnpm = pnpm_12;

  directoriesIn =
    parent:
    map (name: parent + "/${name}") (
      lib.attrNames (lib.filterAttrs (_: type: type == "directory") (builtins.readDir parent))
    );
  # What a package directory of a checkout holds besides sources. A flake sees only the
  # files git tracks; a plain path holds these too.
  notSources =
    dir:
    lib.fileset.unions (
      map (name: lib.fileset.maybeMissing (dir + "/${name}")) [
        "node_modules"
        "lib"
        "dist"
      ]
    );

  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.difference (lib.fileset.unions [
      ../package.json
      ../pnpm-lock.yaml
      ../pnpm-workspace.yaml
      ../tsconfig.base.json
      ../biome.jsonc
      # Biome reads the ignore file to skip build output.
      ../.gitignore
      # What the workspace check lints and compares besides the packages.
      ../README.md
      ../README.ja.md
      ../README.zh.md
      ../.i18n.json
      ../scripts
      ../e2e
      ../.changeset
      ../plugins
      ../tooling
      # Patches pnpm applies to dependencies as it installs them (pnpm-workspace.yaml).
      ../patches
    ]) (lib.fileset.unions (map notSources (directoriesIn ../plugins ++ directoriesIn ../tooling)));
  };

  # One dependency fetch for the whole workspace; pnpm fetches every platform's optional
  # packages, so the hash is the same on every system. After any pnpm-lock.yaml change,
  # update the hash (see AGENTS.md).
  pnpmDeps = fetchPnpmDeps {
    pname = "langify-dsh-plugins";
    version = "0";
    inherit src pnpm;
    fetcherVersion = 4;
    hash = "sha256-jifB6KcKCs0cfalTgueMn8vbBsSp3md3m0Vnv8So4Rc=";
  };

  # A plugin is a directory whose package.json declares a `dsh` field; one that only holds
  # a design note is not one yet.
  isPlugin =
    dir: type:
    type == "directory"
    && builtins.pathExists (../plugins + "/${dir}/package.json")
    && lib.importJSON (../plugins + "/${dir}/package.json") ? dsh;
  pluginDirs = lib.attrNames (lib.filterAttrs isPlugin (builtins.readDir ../plugins));

  # A path the manifest gives relative to the package, without its leading "./".
  inPackage = path: lib.removePrefix "./" path;

  mkPlugin =
    dir:
    let
      manifest = lib.importJSON (../plugins + "/${dir}/package.json");
      # The package's main export: the module DSH loads as the plugin.
      main = manifest.exports."." or manifest.main;
      entry = inPackage (if builtins.isString main then main else main.default);
      bundlePatch = inPackage manifest.dsh.bundle.patch;
      # npm's tarball name for a scoped package: @scope/name → scope-name-version.tgz.
      tarball = "${lib.replaceStrings [ "@" "/" ] [ "" "-" ] manifest.name}-${manifest.version}.tgz";
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
      # session-hooks' tests run real hook commands through bash.
      nativeCheckInputs = [ bash ];

      buildPhase = ''
        runHook preBuild
        pnpm --filter ./plugins/${dir} run build
        runHook postBuild
      '';

      # The plugin's type checks and tests, and those of the workspace packages it is built
      # with; then its tests against DSH's own packages, when it has them. Tests that need
      # a real browser are not run here.
      doCheck = true;
      checkPhase = ''
        runHook preCheck
        pnpm --filter "{./plugins/${dir}}..." run typecheck
        pnpm --filter "{./plugins/${dir}}..." run test
        pnpm --filter ./plugins/${dir} --if-present run test:compat
        runHook postCheck
      '';

      installPhase = ''
        runHook preInstall
        bundle="$out/${finalAttrs.passthru.bundlePath}"
        mkdir -p "$bundle"
        (cd plugins/${dir} && pnpm pack --pack-destination "$out")
        tar -xzf "$out/${tarball}" --strip-components=1 -C "$bundle"
        # The tarball does not keep files' executable bit; the unpacked package keeps its
        # sources' (the examples' scripts), and the fixup then points their shebangs here.
        (cd plugins/${dir} && find . -path ./node_modules -prune -o -type f -perm -u+x -print) |
          while IFS= read -r file; do
            if [ -f "$bundle/$file" ]; then chmod +x "$bundle/$file"; fi
          done
        runHook postInstall
      '';

      # The built entry loads, with its peers resolved from the build's node_modules.
      doInstallCheck = true;
      installCheckPhase = ''
        runHook preInstallCheck
        node --input-type=module -e "
          const plugin = await import('$PWD/plugins/${dir}/${entry}')
          if (typeof plugin.apply !== 'function' || typeof plugin.name !== 'string') process.exit(1)
        "
        runHook postInstallCheck
      '';

      passthru = {
        inherit
          dir
          entry
          tarball
          bundlePatch
          ;
        # The unpacked bundle inside this output; its patch and entry are relative to it.
        bundlePath = "lib/dsh-plugins/${dir}";
        # Whether `dsh --patch` loads the unpacked bundle: unless dsh-plugin-build builds the
        # plugin, whose generated patch names the package rather than paths beside it.
        loadsWithPatch = !(manifest.devDependencies ? "@langify-org/dsh-plugin-build");
      };

      meta = {
        inherit (manifest) description;
        homepage = manifest.homepage or "https://github.com/langify-org/deepseek-harness-plugins";
        license = lib.licenses.mit;
        platforms = lib.platforms.unix;
      };
    });

  # The whole workspace's lint, README check, type checks and unit tests, every package's
  # included: the tooling's too, which no plugin build runs when no plugin uses it.
  check = stdenv.mkDerivation {
    pname = "langify-dsh-plugins-check";
    version = "0";
    inherit src pnpmDeps;
    nativeBuildInputs = [
      nodejs_24
      pnpm
      pnpmConfigHook
      # session-hooks' tests run real hook commands through bash.
      bash
    ]
    ++ lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];
    # Biome's npm binary is linked for a conventional Linux; give it this store's libraries.
    buildInputs = lib.optionals stdenv.hostPlatform.isLinux [ stdenv.cc.cc.lib ];
    dontAutoPatchelf = true;

    buildPhase = ''
      runHook preBuild
      ${lib.optionalString stdenv.hostPlatform.isLinux ''
        for biome in node_modules/.pnpm/@biomejs+cli-linux-*/node_modules/@biomejs/cli-linux-*/biome; do
          chmod u+w "$biome"
          autoPatchelf "$biome"
        done
      ''}
      pnpm run lint
      pnpm run docs:check
      pnpm run typecheck
      pnpm run test
      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall
      touch "$out"
      runHook postInstall
    '';
  };
in
{
  inherit src pnpmDeps check;
  plugins = lib.genAttrs pluginDirs mkPlugin;
}
