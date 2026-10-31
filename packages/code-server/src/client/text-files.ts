import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'

// Links to these open in Code; images, PDFs, Office documents and unknown
// types stay with DSH's own viewers.
const TEXT_EXTENSIONS = new Set(
  (
    'txt text md mdx rst adoc log nix rs toml lock json jsonc json5 yaml yml xml html htm css scss sass less ' +
    'js jsx ts tsx mjs cjs mts cts py pyi sh bash zsh fish sql go java kt kts c h cpp cc cxx hpp cs rb php lua ' +
    'vim el clj cljs ex exs erl hrl ini conf cfg env properties service socket timer target path desktop diff ' +
    'patch csv tsv graphql proto'
  ).split(' '),
)
const TEXT_NAMES = new Set(
  (
    'readme license licence copying notice makefile gnumakefile dockerfile containerfile justfile gemfile ' +
    'rakefile procfile .gitignore .gitattributes .gitmodules .editorconfig .npmrc .nvmrc .env .bashrc .zshrc'
  ).split(' '),
)

/** Whether a `dsh-resource://file/...` address names a text file Code should open. */
export function isTextFileAddress(address: string): boolean {
  const name = parseFileAddress(address)?.path.split('/').pop()?.toLowerCase()
  if (!name) return false
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
  return TEXT_NAMES.has(name) || TEXT_EXTENSIONS.has(extension) || name.startsWith('.env.')
}
