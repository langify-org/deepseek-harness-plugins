# Security

English | [日本語](SECURITY.ja.md) | [中文](SECURITY.zh.md)

## What a plugin can do

A DSH plugin runs inside the DSH host process with the permissions of the user who started DSH. It is not confined by the sandbox that DSH applies to agent tools. Install only plugins whose source you trust.

Packages in this repository run no install scripts and ship only built files, with their sources in this repository.

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub security advisories](https://github.com/langify-org/deepseek-harness-plugins/security/advisories/new). Do not open a public issue.

Include the affected package and version, the DSH version, and steps to reproduce.
