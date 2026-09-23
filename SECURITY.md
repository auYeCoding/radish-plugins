# Security Policy

## Supported versions

Only the latest released version of each plugin in this repository receives security fixes. See the [README](README.md#updating) for how to update.

## Reporting a vulnerability

Please do not report security vulnerabilities through public issues, discussions, or pull requests.

Report them privately through [GitHub private vulnerability reporting](https://github.com/auYeCoding/radish-plugins/security/advisories/new). Please include:

- The affected plugin, component, and version
- A description of the issue and its impact
- Steps to reproduce, or a proof of concept
- A suggested fix, if you have one

## What to expect

This project is maintained on a best-effort basis. The maintainer will acknowledge your report, keep you informed of progress, and credit you in the published advisory unless you prefer to remain anonymous. Please allow time for a fix to be released before disclosing the issue publicly.

## Scope

In scope is everything shipped in this repository's plugins, such as skills, agents, hooks, scripts, and configuration. Examples include instructions that could lead Claude to run unintended destructive commands, leak sensitive data, or act on untrusted input.

Vulnerabilities in Claude Code itself are out of scope. Report them to Anthropic as described in the [Claude Code security policy](https://github.com/anthropics/claude-code/security/policy).
