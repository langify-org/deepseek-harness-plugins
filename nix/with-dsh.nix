# Make a built plugin loadable by one DSH installation.
#
# DSH resolves a plugin's `@deepseek-ai/*` peers to its own copies only for
# packages installed in a profile. A plugin loaded with `--patch` from the Nix
# store is outside every profile, so Node's ordinary lookup must find DSH's
# modules: the bundle is copied (not linked, Node follows real paths) beside a
# `node_modules` link to the installation's own `node_modules`.
#
# The result's `patch` attribute is the bundle's cordis.patch.yml, ready for
# `dsh --patch`. Its relative entry (./lib/index.js) resolves beside it.
{
  lib,
  stdenvNoCC,
  nodejs_24,
}:
{
  plugin,
  # The DSH installation's node_modules directory, e.g.
  # "${deepseekHarness}/lib/deepseek-harness/node_modules".
  dshNodeModules,
}:
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "${plugin.pname}-for-dsh";
  inherit (plugin) version;
  dontUnpack = true;

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/lib"
    cp -r ${plugin}/${plugin.bundlePath} "$out/lib/${plugin.dir}"
    ln -s ${dshNodeModules} "$out/lib/node_modules"
    runHook postInstall
  '';

  # The entry and its peers load from this layout, as DSH will load them.
  doInstallCheck = true;
  nativeInstallCheckInputs = [ nodejs_24 ];
  installCheckPhase = ''
    runHook preInstallCheck
    node --input-type=module -e "
      const plugin = await import('$out/lib/${plugin.dir}/lib/index.js')
      if (typeof plugin.apply !== 'function') process.exit(1)
    "
    runHook postInstallCheck
  '';

  passthru = {
    inherit (plugin) dir;
    unwrapped = plugin;
    patch = "${finalAttrs.finalPackage}/lib/${plugin.dir}/cordis.patch.yml";
  };

  meta = plugin.meta // {
    description = "${plugin.meta.description} (wired to one DSH installation)";
  };
})
