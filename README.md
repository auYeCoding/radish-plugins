# radish-plugins

English | [简体中文](README.zh-CN.md)

[![Validate](https://github.com/auYeCoding/radish-plugins/actions/workflows/validate.yml/badge.svg)](https://github.com/auYeCoding/radish-plugins/actions/workflows/validate.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A [Claude Code](https://code.claude.com) plugin marketplace maintained by auYeCoding.

## Plugins

| Plugin                                    | Description                      | Docs                                 |
| ----------------------------------------- | -------------------------------- | ------------------------------------ |
| [WayPoint](plugins/waypoint) (`waypoint`) | Workflow skills for Claude Code. | [README](plugins/waypoint/README.md) |

## Installation

Run these commands inside Claude Code.

1. Add the marketplace:

   ```text
   /plugin marketplace add auYeCoding/radish-plugins
   ```

2. Install a plugin:

   ```text
   /plugin install waypoint@radish-plugins
   ```

## Updating

Each plugin pins its version, so updates arrive only when a new version is released. From a terminal:

```bash
claude plugin marketplace update radish-plugins
claude plugin update waypoint@radish-plugins
```

Restart Claude Code to apply the update. See each plugin's `CHANGELOG.md` for what changed.

## Contributing

Issues and pull requests are welcome. Please read the [contributing guide](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md) first.

## Security

Do not report security vulnerabilities in public issues. See [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)

## Disclaimer

This is an independent community project. It is not affiliated with, endorsed by, or sponsored by Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic, PBC.
