# Security

English | [日本語](SECURITY.ja.md) | [中文](SECURITY.zh.md)

## What a plugin can do

A DSH plugin runs inside the DSH host process with the permissions of the user who started DSH. It is not confined by the sandbox that DSH applies to agent tools. Install only plugins whose source you trust.

Packages in this repository run no install scripts and ship only built files, with their sources in this repository.

## Plugin-specific notes

- **[@langify-org/dsh-code-server](packages/code-server)** serves code-server from DSH's own origin, behind DSH's authentication; code-server itself listens only on a private Unix socket. Code running in code-server, including its terminal, extensions and their webviews, acts as you outside DSH's sandbox, and as same-origin content it can also use DSH with your session. Treat installing a code-server extension like installing a DSH plugin.

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub security advisories](https://github.com/langify-org/deepseek-harness-plugins/security/advisories/new). Do not open a public issue.

Include the affected package and version, the DSH version, and steps to reproduce.
