# Tasks for humans and agents. `just --list` shows them.

set shell := ["bash", "-euo", "pipefail", "-c"]

root := justfile_directory()

# Type check, test, and build every plugin
check:
    pnpm run check

# Run one plugin's tests (e.g. `just test session-hooks`)
test plugin:
    pnpm --filter ./plugins/{{plugin}} run test

# Build a plugin and run its end-to-end check against a real dsh, in a throwaway DSH home.
# Pass DSH_E2E_PROVIDER_PATCH=<patch with your model rows> to include the one model request.
e2e plugin="session-hooks" *env:
    pnpm --filter ./plugins/{{plugin}} run build
    {{env}} node e2e/{{plugin}}/run.mjs

# The same check against the packed tarball, installed with `dsh plugin add`
e2e-tarball plugin="session-hooks":
    rm -rf "{{root}}/.dsh-dev/pack" && mkdir -p "{{root}}/.dsh-dev/pack"
    pnpm --filter ./plugins/{{plugin}} pack --pack-destination "{{root}}/.dsh-dev/pack"
    DSH_E2E_TARBALL="$(ls "{{root}}"/.dsh-dev/pack/*.tgz)" node e2e/{{plugin}}/run.mjs

# A development DSH Web UI with one plugin, in its own DSH home (.dsh-dev/home) and port.
# Put your model provider rows and hook config in dev/local.patch.yml (see dev/local.patch.example.yml).
# HMR reloads the plugin when its lib/ changes, so run `just watch <plugin>` beside it.
dev plugin port="3091":
    pnpm --filter ./plugins/{{plugin}} run build
    mkdir -p "{{root}}/.dsh-dev"
    printf -- '- id: hmr\n  disabled: false\n  config:\n    root: ["%s"]\n' "{{root}}/plugins/{{plugin}}/lib" > "{{root}}/.dsh-dev/hmr.patch.yml"
    patches=(--patch "{{root}}/plugins/{{plugin}}/cordis.patch.yml" --patch "{{root}}/.dsh-dev/hmr.patch.yml"); \
    if [ -f "{{root}}/dev/local.patch.yml" ]; then patches+=(--patch "{{root}}/dev/local.patch.yml"); fi; \
    env $(env | grep -o '^DSH_[A-Z_]*' | sed 's/^/-u /') DSH_HOME="{{root}}/.dsh-dev/home" \
      dsh web "${patches[@]}" --port {{port}} --no-open

# Rebuild a plugin on every source change (pairs with `just dev`)
watch plugin:
    pnpm --filter ./plugins/{{plugin}} exec tsc -p tsconfig.build.json --watch

# Build the Nix packages, which also runs every plugin's tests in the sandbox
nix-check:
    nix flake check -L

# Record a release note for the changed plugins
changeset:
    pnpm changeset
