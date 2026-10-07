# Project skills

Vendored copies of reviewed third-party skills (reviewed 2026-10-07: no hooks, no scripts, no network access at load time).

| Skill                   | Source                                                                             | Changes                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `tdd`                   | [mattpocock/skills](https://github.com/mattpocock/skills) `skills/engineering/tdd` | none                                                                                 |
| `grill-me`, `grilling`  | mattpocock/skills `skills/productivity/*`                                          | none                                                                                 |
| `web-design-guidelines` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills)            | rules vendored to `rules.md` instead of fetching an unpinned URL on every run        |
| `shadcn`                | [shadcn-ui/ui](https://github.com/shadcn-ui/ui) `skills/shadcn`                    | removed auto-executed `npx shadcn@latest info` and the blanket `allowed-tools` grant |
| `offline-sync`          | this project                                                                       | —                                                                                    |

Deliberately **not** installed: `impeccable` (downloads and runs a native binary every session, telemetry,
installs hooks), mattpocock `code-review` (name clashes with the built-in `/code-review`).
