# Changesets

Each pull request that changes a published plugin adds a changeset: run `pnpm changeset` (or `just changeset`), choose the plugins and the bump, and describe the change for users. The release workflow turns pending changesets into a "Version packages" pull request; merging it publishes to npm.
