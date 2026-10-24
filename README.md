# OpenCode Community Marketplace CLI

Install community skills, agents, commands, and local MCP servers from the public OpenCode
Marketplace registry.

Independent community project. It is not affiliated with or endorsed by Anomaly.
Marketplace submissions are unreviewed. Read package source before using it.

## Install

Requires Node.js 20 or newer, npm, and Git.

```sh
npm install --global github:kabirprokk/opencode-marketplace
```

The project is not published under the unscoped npm name `opencode-marketplace`.

## Commands

```sh
ocm list
ocm search <query>
ocm info <name>
ocm install <name>
ocm remove <name>
```

Packages are installed under `~/.config/opencode/skills`, `agents`, and
`commands`. MCP servers are installed under `~/.config/opencode/mcp` and added
to `opencode.json`; an existing MCP configuration is never overwritten. OCM
denies each installed MCP tool namespace for other agents by default and adds
access to the `mcp-tools` primary agent. Switch to that agent when a task needs
MCP tools, keeping large tool sets out of your usual agent context. Existing
files are never overwritten. Skill packs install their contained skills, agents,
and commands individually. `ocm remove` removes only paths recorded by this
CLI's install manifest and removes an MCP config only when it still matches the
CLI-installed server.

The registry is cached locally for five minutes, with a stale copy used for up
to seven days if the registry cannot be reached. This avoids a network roundtrip
for every `ocm list`, `search`, or `info` command; use `ocm install` to install a
package from its source repository.

Installations are copied from the latest default branch. The CLI does not yet
provide pinned versions, integrity attestations, or automatic updates. Treat
installed instructions as untrusted input.

## Registry and website

- Registry: https://github.com/kabirprokk/opencode-registry
- Website: https://ocmskills.vercel.app

## Development

```sh
npm test
node bin/ocm.js help
```

## License

MIT. See [LICENSE](./LICENSE).
