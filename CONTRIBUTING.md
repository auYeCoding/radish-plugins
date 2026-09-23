# Contributing to radish-plugins

Thanks for your interest in contributing. This guide explains how the repository is organized and how to get a change merged.

By participating in this project you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Report a bug or request a feature** with the [issue forms](https://github.com/auYeCoding/radish-plugins/issues/new/choose).
- **Report a security vulnerability** privately, as described in [SECURITY.md](SECURITY.md).
- **Open a pull request.** For anything beyond a small fix, open an issue first so the approach can be agreed on before you invest time in it.

## Repository layout

```text
.claude-plugin/marketplace.json   Marketplace catalog that lists every plugin
plugins/<plugin>/                 One directory per plugin, installed and versioned independently
  .claude-plugin/plugin.json      Plugin manifest, the only place the plugin version is set
  skills/<skill>/SKILL.md         One directory per skill
  README.md, README.zh-CN.md      Plugin documentation in English and Simplified Chinese
  CHANGELOG.md                    Plugin changelog
scripts/                          Repository tooling
.github/                          Issue forms, pull request template, and CI workflows
```

## Development setup

Prerequisites: Git, Node.js 22 or later, and [Claude Code](https://code.claude.com).

1. Fork the repository on GitHub, then clone your fork:

   ```bash
   git clone https://github.com/<your-username>/radish-plugins.git
   cd radish-plugins
   git remote add upstream https://github.com/auYeCoding/radish-plugins.git
   ```

2. Install the development tools:

   ```bash
   npm ci
   ```

## Making a change

1. Create a branch from the latest `upstream/main`, named `<type>/<short-description>`, for example `feat/commit-message-scopes`:

   ```bash
   git fetch upstream
   git switch -c feat/commit-message-scopes upstream/main
   ```

2. Make your change and [test it locally](#testing-locally).
3. Format and validate:

   ```bash
   npm run format
   npm run validate
   ```

4. Commit following the [commit message convention](#commit-messages).
5. Push the branch to your fork and open a pull request against `main`. Fill in the pull request template.
6. Keep the pull request focused on one change. If `main` moves ahead, rebase your branch onto `upstream/main` instead of merging it in.

CI runs the same format and validation checks on every pull request, and every pull request needs an approving review from a code owner before it can be merged.

## Testing locally

Load a plugin straight from your working tree for one session:

```bash
claude --plugin-dir ./plugins/waypoint
```

Plugin skills are invoked as `/<plugin>:<skill>`, for example `/waypoint:commit-message`. Run `/reload-plugins` after editing files to pick up the changes.

To test the full marketplace install flow, add your working tree as a marketplace. If you already added the published `radish-plugins` marketplace, remove it first, because marketplace names must be unique.

```text
/plugin marketplace add ./
/plugin install waypoint@radish-plugins
```

## Adding a skill

1. Create `plugins/<plugin>/skills/<skill-name>/SKILL.md`. Skill names use lowercase letters, digits, and hyphens, and match their directory name.
2. In the frontmatter, set `name` and a `description` that says what the skill does and when Claude should use it.
3. Keep `SKILL.md` focused and under 500 lines. Move detailed material into supporting files inside the skill directory, link them from `SKILL.md`, and reference bundled scripts through `${CLAUDE_SKILL_DIR}`.
4. Never reference files outside the plugin directory. Each plugin is copied on its own at install time, so such paths break for users.
5. Add the skill to the skill table in the plugin's `README.md` and `README.zh-CN.md`, and add a `CHANGELOG.md` entry.

## Adding a plugin

Please open an issue to discuss a new plugin before starting.

1. Create `plugins/<plugin-name>/` with a kebab-case name, and add `.claude-plugin/plugin.json`. Use [`plugins/waypoint`](plugins/waypoint/.claude-plugin/plugin.json) as the reference for the required fields, and start at version `0.1.0`.
2. Add `README.md`, `README.zh-CN.md`, and `CHANGELOG.md` to the plugin directory.
3. Register the plugin in [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json) with its `name` and a `source` of `./plugins/<plugin-name>`.
4. Add the plugin to the plugin table in the root `README.md` and `README.zh-CN.md`.

Plugins cannot share files with each other. If several plugins need the same functionality, put it in its own plugin and declare it under `dependencies` in the plugins that need it.

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```text
<type>(<scope>): <summary>
```

- **type**: `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, or `chore`.
- **scope**: the plugin name, such as `waypoint`. Omit it for repository-wide changes.
- **summary**: English in the imperative mood and lowercase, or Simplified Chinese. No trailing period.

Examples:

```text
feat(waypoint): add commit-message skill
fix(waypoint): 修复未跟踪文件未纳入提交消息的问题
docs: clarify local testing steps
```

Pull requests are squash-merged, so the pull request title becomes the commit message on `main` and must follow the same convention.

## Documentation

- Every README exists in English (`README.md`) and Simplified Chinese (`README.zh-CN.md`). Update both in the same pull request.
- All other documentation is written in English.

## Versioning and releases

Each plugin is versioned independently with [Semantic Versioning](https://semver.org). A plugin's version is set only in its `plugin.json`, and users receive an update only when that version changes.

- **Contributors** do not bump versions. Add your changes under `## [Unreleased]` in the affected plugin's `CHANGELOG.md`.
- **Maintainers** release a plugin by bumping `version` in its `plugin.json`, moving the `Unreleased` entries into a new version section, merging that change, and tagging the release from `main`:

  ```bash
  claude plugin tag ./plugins/<plugin> --push
  ```

  This creates and pushes a `<plugin>--v<version>` tag. Then publish a GitHub release from that tag.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
