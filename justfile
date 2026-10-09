# Tasks for humans and agents. `just --list` shows them.

set shell := ["bash", "-euo", "pipefail", "-c"]

root := justfile_directory()
devdir := root / ".dsh-dev"
# DSH places its first-use workspace at <documentsDirectory>/deepseek-harness/default-workspace.
playground := devdir / "documents" / "deepseek-harness" / "default-workspace"

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

# It has its own DSH home (.dsh-dev/home) and port. Its default workspace is
# `playground` below, a throwaway git repository, so neither your own DSH nor
# this checkout is touched. It loads dev/<plugin>.patch.yml (the plugin's dev
# config), then dev/local.patch.yml (yours; `just dev-use-profile` links it to
# your model setup).
# HMR reloads the plugin when its lib/ changes, so run `just watch <plugin>` beside it.
#
# A development DSH Web UI with one plugin, opened in your browser (--no-open to skip)
dev plugin port="3091" *flags:
    pnpm --filter ./plugins/{{plugin}} run build
    mkdir -p "{{devdir}}"
    printf -- '- id: hmr\n  disabled: false\n  config:\n    root: ["%s"]\n- id: workspace-controller\n  config:\n    documentsDirectory: "%s"\n' \
      "{{root}}/plugins/{{plugin}}/lib" "{{devdir}}/documents" > "{{devdir}}/dev.patch.yml"
    if [ ! -d "{{playground}}/.git" ]; then \
      mkdir -p "{{playground}}" && git -C "{{playground}}" init -q -b main && \
      echo '# DSH dev playground' > "{{playground}}/README.md" && \
      git -C "{{playground}}" add README.md && \
      git -C "{{playground}}" -c user.name=dev -c user.email=dev@example.invalid commit -q -m init; \
    fi
    seed="{{root}}/dev/{{plugin}}.playground"; marker="{{playground}}/.git/langify-seeded-{{plugin}}"; \
    if [ -d "$seed" ] && [ ! -e "$marker" ]; then cp -R "$seed/." "{{playground}}/" && touch "$marker"; fi
    if [ ! -f "{{root}}/dev/local.patch.yml" ]; then \
      echo 'note: no dev/local.patch.yml, so sessions cannot reach a model; run `just dev-use-profile` once.' >&2; \
    fi
    patches=(--patch "{{root}}/plugins/{{plugin}}/cordis.patch.yml" --patch "{{devdir}}/dev.patch.yml"); \
    for extra in "{{root}}/dev/{{plugin}}.patch.yml" "{{root}}/dev/local.patch.yml"; do \
      if [ -f "$extra" ]; then patches+=(--patch "$extra"); fi; \
    done; \
    cd "{{playground}}" && \
    env $(env | grep -o '^DSH_[A-Z_]*' | sed 's/^/-u /') \
      DSH_HOME="{{devdir}}/home" DSH_TELEMETRY_DISABLED=1 \
      LANGIFY_DEV_ROOT="{{root}}" DSH_WORKTREES_DIR="{{devdir}}/worktrees" \
      dsh web "${patches[@]}" --port {{port}} {{flags}}

# Let `just dev` reach your model provider: link dev/local.patch.yml to a profile's patch (read only)
dev-use-profile profile="web":
    src="${DSH_HOME:-$HOME/.dsh}/profiles/{{profile}}/cordis.patch.yml"; \
    test -f "$src" || { echo "no profile patch at $src" >&2; exit 1; }; \
    dest="{{root}}/dev/local.patch.yml"; \
    if [ -e "$dest" ] && [ ! -L "$dest" ]; then echo "$dest is your own file; move it away first" >&2; exit 1; fi; \
    ln -sfn "$src" "$dest" && echo "dev/local.patch.yml -> $src"

# Rebuild a plugin on every source change (pairs with `just dev`)
watch plugin:
    pnpm --filter ./plugins/{{plugin}} run watch

# Build the Nix packages, which also runs every plugin's tests in the sandbox
nix-check:
    nix flake check -L

# Record a release note for the changed plugins
changeset:
    pnpm changeset
