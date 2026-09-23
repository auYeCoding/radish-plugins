# Maintaining

English | [简体中文](MAINTAINING.md)

This guide is for maintainers. It lists what else needs updating when you change something in this repository, plus the conventions you cannot infer from the files alone. For the contribution workflow (forking, branches, commit convention, local testing), see [CONTRIBUTING.md](CONTRIBUTING.md).

## Change checklist

| What you changed                                              | What else to update                                                                                                                                        |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any Chinese document                                          | Its English counterpart (`*.en.md`), and the other way around                                                                                              |
| A skill's behavior (`SKILL.md` or `references/`)              | The skill's Chinese and English guides, the skill summary in the plugin and root READMEs (if its purpose changed), and `Unreleased` in `CHANGELOG.md`      |
| A skill's `description`                                       | Test automatic triggering again by hand (see [Pre-release manual tests](#pre-release-manual-tests))                                                        |
| `shared/punctuation.md`                                       | Every skill is affected, so test them all; also run `npm run gen:docs`, because the generated documents of `project-navigator` embed the punctuation rules |
| The spec, runtime, or document sources of `project-navigator` | See the [project-navigator maintainer guide](plugins/waypoint/docs/project-navigator-maintaining.en.md#change-process)                                     |
| A new skill                                                   | See [Adding a skill](#adding-a-skill)                                                                                                                      |
| A new plugin                                                  | See [Adding a plugin](#adding-a-plugin)                                                                                                                    |
| Anything users will notice in a plugin                        | Release it: bump `version` in `plugin.json`, or users never receive the change                                                                             |
| The CI job name (`validate.yml`)                              | The required check name in the GitHub branch rules, or no pull request can be merged                                                                       |
| What the banner shows, such as the skill list                 | Regenerate the PNG and upload the social preview again in the GitHub settings                                                                              |
| The repository, user, marketplace, or plugin name             | See [Hard-coded names and links](#hard-coded-names-and-links)                                                                                              |

## Documentation

### Chinese and English copies

These documents exist in Chinese (the default) and English, and both must be updated in the same pull request:

- `README.md` and `README.en.md` in the repository root and in every plugin directory.
- `docs/<skill>.md` and `docs/<skill>.en.md` for every skill, plus `docs/<skill>-maintaining.md` and `docs/<skill>-maintaining.en.md` for skills with a maintainer guide.
- This guide, `MAINTAINING.md` and `MAINTAINING.en.md`.

The other documents (`CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`) are English only. A skill's `SKILL.md` and `references/` are written for Claude, in Chinese.

### Skill rules versus documentation

- `SKILL.md` and `references/` are the single source of truth for a skill's behavior. Change them first, then update the guides.
- Skill guides describe only what users see. When the full rules are needed, link to `references/` instead of copying them.
- A plugin README is only a hub (introduction, skill table, quick start). Skill details belong in the skill guides.

### Links and anchors

- The anchor of a Chinese heading is the Chinese text itself, such as `#安装`. Renaming a heading breaks links to it, so check what points to it after the change.
- When documents link to each other, Chinese documents link to the Chinese versions and English documents to the English versions.

## Skills

### Changing a skill

1. Change the rules in `SKILL.md` or `references/`.
2. Update the skill's Chinese and English guides. If its purpose changed, also update the skill summary in the plugin and root READMEs.
3. Record user-visible changes under `## [Unreleased]` in the plugin's `CHANGELOG.md`.
4. Test the affected scenarios by hand with `claude --plugin-dir ./plugins/<plugin>`.

### Adding a skill

After completing the skill and its guides as described in "Adding a skill" in [CONTRIBUTING.md](CONTRIBUTING.md), also:

- Add a row to the skill tables in the root and plugin READMEs, in both languages, linking to the skill's guide.
- Update the command menu in the banner, then regenerate and upload it (see [Social preview and banner](#social-preview-and-banner)).
- If the new skill can also be triggered by phrases like "commit", check whether its `description` competes with an existing skill.

### Design decisions

Each of these decisions has a concrete reason. Understand it before changing it:

- **`commit-message` asks A/B in plain text, not in a question box.** When a question box appears, text earlier in the same reply may not be displayed, so users would not see the commit message.
- **`SKILL.md` uses only `description`, not `when_to_use`.** Only Claude Code supports `when_to_use`, and other Agent Skills hosts drop the trigger conditions in it. Keep `description` within 1,024 characters.
- **Shared rules live in the plugin-level `shared/` directory**, and skills reference them with relative paths such as `../../shared/<file>`. `${CLAUDE_PLUGIN_ROOT}` is not used because editors and GitHub cannot resolve it.
- **Skills never reference files outside their plugin directory.** Each plugin is copied on its own at install time, so such paths break for users.
- **`commit-message` never calls `repo-init` or runs `git init`.** It only tells the user to initialize the repository first.
- **`SKILL.md` does not set `allowed-tools`.** Read-only git commands need no approval anyway, and keeping the permission prompt for `git add`, `git commit`, and `git push` is a safety net against accidental triggering. The only exception is `project-navigator`; see its [maintainer guide](plugins/waypoint/docs/project-navigator-maintaining.en.md#design-decisions) for why.
- **The design decisions and troubleshooting for `project-navigator` live in its own maintainer guide.** Read the [project-navigator maintainer guide](plugins/waypoint/docs/project-navigator-maintaining.en.md) before changing it.
- **Commit messages reach `git commit -F -` through standard input as UTF-8.** Pipes in Windows PowerShell 5.1 are not UTF-8 by default, so `$OutputEncoding` must be set first or Chinese text is garbled.
- **Commit messages never carry authorship trailers**, and users cannot opt out of this rule.

## Plugins

### Adding a plugin

After completing "Adding a plugin" in [CONTRIBUTING.md](CONTRIBUTING.md), also:

- Add a version badge for the plugin to the root READMEs in both languages. Replace `plugins/waypoint` in the badge URL with the new plugin's directory.
- Update the banner if needed.
- Check that the examples (`placeholder`) in the issue forms still make sense.
- If someone else owns the new plugin, assign its directory in `.github/CODEOWNERS`.

`scripts/validate.mjs` reads the plugin list from `marketplace.json`, so new plugins are validated automatically without changing the script.

### Renaming a plugin or skill

- After renaming a plugin, map the old name to the new one in the `renames` field of `marketplace.json`, so that existing installations migrate smoothly.
- Renaming a skill changes its slash command (`/<plugin>:<skill>`), so note it in `CHANGELOG.md`.
- Then replace every occurrence listed in [Hard-coded names and links](#hard-coded-names-and-links).

## Releasing a plugin version

Each plugin is released on its own and follows Semantic Versioning. Its version is set only in `version` in `plugin.json`. Never add a version to `marketplace.json`.

1. Create a release branch from `main` and bump `version` in `plugin.json`.
2. In `CHANGELOG.md`, move the entries under `## [Unreleased]` into a new section (`## [x.y.z] - YYYY-MM-DD`), keep an empty `Unreleased` section, and update the version comparison links at the bottom, if any.
3. Open a pull request and squash-merge it once CI passes.
4. Switch to the latest `main`, then create and push the tag:

   ```bash
   claude plugin tag ./plugins/<plugin> --push
   ```

   It checks that `plugin.json` and `marketplace.json` agree, then creates a tag named `<plugin>--v<version>`.

5. Create a GitHub release from that tag, using the version's section of the changelog as the notes:

   ```bash
   gh release create <plugin>--v<version> --title "<Plugin display name> <version>" --notes-file <notes file>
   ```

6. Verify that the version badge in the README shows the new version, and that after `claude plugin marketplace update radish-plugins`, `claude plugin update <plugin>@radish-plugins` installs it.

Forgetting to bump the version is the most common mistake: if the version does not change, users receive no update at all.

## Repository settings

These settings live on GitHub, not in the repository files. Check them whenever the related files change:

| Setting                                   | Related to                                                                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch ruleset "Protect main"             | Requires pull requests and the "Format and plugin checks" check, allows squash merges only, blocks force pushes and deletion, needs no approvals, and has no bypass |
| Required check "Format and plugin checks" | Must equal the job name (`jobs.validate.name`) in `.github/workflows/validate.yml`                                                                                  |
| Squash merge commit message               | Title from the pull request title, body from the commit messages in the pull request. The description in `CONTRIBUTING.md` relies on this setting                   |
| Automatically delete head branches        | Enabled                                                                                                                                                             |
| Discussions                               | Enabled. `.github/ISSUE_TEMPLATE/config.yml` links to the `q-a` category, so update it if the category is renamed                                                   |
| Private vulnerability reporting           | Enabled. `SECURITY.md` and the issue form chooser depend on it                                                                                                      |
| Description and topics                    | Update them when the positioning changes                                                                                                                            |
| Social preview                            | Can only be uploaded by hand in the web interface; see the next section                                                                                             |

## Social preview and banner

- The source is `.github/assets/social-preview.html`, and the generated image is `social-preview.png` in the same directory. The banner at the top of both READMEs uses this PNG directly.
- After editing the source, regenerate the PNG with headless Chrome, using the command in the comment at the top of the source file.
- The README banner updates with the PNG, but the social preview must be uploaded again under Settings > General > Social preview.
- Put preformatted content that must keep its line breaks in `<pre>`. Otherwise prettier merges it into one paragraph when formatting.

## Dependencies and CI

- **Dependabot** checks the npm dependencies (`prettier`, `@anthropic-ai/claude-code`) and GitHub Actions weekly and opens pull requests. Merge them once CI passes.
- **After upgrading `@anthropic-ai/claude-code`**, the new validator may report new warnings. CI runs with `--strict`, so warnings fail the build. Fix the plugin files as reported instead of dropping `--strict`.
- **GitHub Actions** are pinned to full commit SHAs with the version in a comment, and dependabot upgrades them.
- **Node.js:** CI uses version 24. `engines` in `package.json` requires 22 or later, because the Claude Code npm package does.
- **Before committing**, run `npm run format`, `npm run validate`, and `npm test`. After changing the spec or document sources of `project-navigator`, run `npm run gen:docs` first. CI runs the same checks, and confirms with `npm run gen:docs -- --check` that the generated documents are in sync.

## Hard-coded names and links

When the repository moves or something is renamed, replace every occurrence below. A project-wide search in your editor confirms nothing is missed.

| Name                                   | Where it appears                                                                                                                                                                                                                                                            |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository `auYeCoding/radish-plugins` | Both root READMEs (badges and links), `CONTRIBUTING.md`, `SECURITY.md`, `package.json`, `homepage` and `repository` in `plugin.json`, the files in `.github/ISSUE_TEMPLATE/`, the pull request template                                                                     |
| User `auYeCoding`                      | `owner` in `marketplace.json`, `author` in `plugin.json`, `.github/CODEOWNERS`, `LICENSE`                                                                                                                                                                                   |
| Marketplace `radish-plugins`           | `name` in `marketplace.json`, the install, update, and uninstall commands in the READMEs, local testing in `CONTRIBUTING.md`, the banner source                                                                                                                             |
| Plugin `waypoint`                      | `marketplace.json`, `plugin.json`, the plugin table, commands, and version badge URL in the READMEs, examples in `CONTRIBUTING.md`, examples in the issue forms, the banner source, the subagent and skill names in the `project-navigator` guard (`runtime/lib/guard.mjs`) |
| State directory `.navigator`           | `runtime/lib/paths.mjs` of `project-navigator`, the allow rules (`runtime/lib/settings.mjs`), its references and guides                                                                                                                                                     |
| Code of Conduct contact email          | `CODE_OF_CONDUCT.md`                                                                                                                                                                                                                                                        |

## Local development and testing

- **Load for one session:** `claude --plugin-dir ./plugins/<plugin>`. After editing files, run `/reload-plugins` in the session.
- **Full install flow:** in Claude Code, run `/plugin marketplace add ./`, then `/plugin install <plugin>@radish-plugins`. Marketplace names must be unique, so remove the published `radish-plugins` marketplace first if you added it.
- **Quick smoke test:** run `claude -p "<prompt>" --plugin-dir ./plugins/<plugin>` in a temporary directory. This mode has no question box, so the skills list options in plain text where they would otherwise ask.
- **Note:** any other skill on your machine that writes commit messages competes with `commit-message` for triggering. Disable it before testing.

### Pre-release manual tests

Before a release, confirm each item in a temporary directory:

1. "帮我写个提交消息", "write a commit message", and "改完了, 提交吧" trigger `commit-message`.
2. "解释 rebase 和 merge 的区别", "帮我写 PR 描述", "看看最近 5 次提交改了什么", and "更新一下 CHANGELOG" do not trigger it.
3. With only staged changes, the message covers only the staged content.
4. With nothing staged, new untracked files appear in the bullet points.
5. With no changes, the reply says there is nothing to commit.
6. `/waypoint:commit-message fix` produces the `fix` type.
7. When Claude edited some files and you edited others, it asks whether to include them before writing the message.
8. When you only ask for a message, the reply ends with `[如何处理?]` and options A and B. A commits, and B commits and pushes.
9. "帮我提交" and "帮我提交并推送" act right away, the message has no authorship trailer, and Chinese text is intact (test once with Bash and once with PowerShell).
10. Asking for a `Co-Authored-By` trailer is refused.
11. A new branch without an upstream gets one; a rejected push is reported as is.
12. In a directory that is not a Git repository, `commit-message` only suggests running `repo-init`.
13. Every rule in the three files from `repo-init` has a one-line comment and groups are separated by a blank line; after `git init`, it lists the files to track and asks you to confirm.
14. With an existing `.editorconfig`, `repo-init` asks whether to merge or skip.
15. `project-navigator`: confirm each item of the [pre-release manual tests](plugins/waypoint/docs/project-navigator-maintaining.en.md#pre-release-manual-tests) in its maintainer guide.

## Known fragile points

- **Competing skills:** if users have another skill that writes commit messages, Claude may pick the wrong one. The guides tell users to disable such skills.
- **Invisible carriage returns:** two rules in the `Global/macOS` `.gitignore` template contain a carriage return (`Icon\r`), and some editors break them when saving.
- **Changes in Claude Code:** new versions may change which skill frontmatter fields are supported or how validation works. Watch CI results and skill behavior after upgrading.
- **Hook input and output formats:** `project-navigator` relies on the fields and return formats of hook events, and its maintainer guide records the version they were measured on. After upgrading Claude Code, run `npm test` and repeat the measurements described in that guide.
