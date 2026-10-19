# Jigx icon migration

One-time skill that moves a Jigx solution's icons from Streamline names to
[Tabler Icons](https://tabler.io/icons) 3.49.0 (outline set), then opens a review page so you
can check every pick by eye.

Background, before/after screens and performance numbers:
https://claude.ai/artifact/FPf6BHdy1yYs3viusPeQXn

## Install

You need Node.js 18+ and read access to this private repo. Sign in to GitHub once:

```bash
gh auth login
```

**Claude Code**

```text
/plugin marketplace add jigx-com/icon-migration
/plugin install icon-migration@jigx-icon-migration
```

**Codex and other agents** (uses the [`skills`](https://github.com/vercel-labs/skills) CLI)

```bash
npx skills add jigx-com/icon-migration -g -a codex
```

## Use

Open your solution folder and run `/icon-migration` in Claude Code, or ask your agent to
"migrate the icons in this solution". Do one solution at a time.

1. The agent scans the solution, picks Tabler names, rewrites the files and opens the review
   page.
2. Change any pick you don't like, press **Copy changes for the agent** and paste the result
   back into the chat.
3. When you're happy, delete the `.icon-migration` folder, publish, and open the solution in
   the app. A red question mark means a name Tabler doesn't have.

To undo, ask the agent to revert the icon migration (`apply.mjs --revert`).

## Uninstall

```text
/plugin uninstall icon-migration@jigx-icon-migration
/plugin marketplace remove jigx-icon-migration
```

```bash
npx skills remove icon-migration -g
```

## What's inside

| Path | Purpose |
| --- | --- |
| `skills/icon-migration/SKILL.md` | The workflow the agent follows |
| `skills/icon-migration/scripts/scan.mjs` | Finds every icon name and sorts it into mapped, pending and maybe |
| `skills/icon-migration/scripts/apply.mjs` | Validates choices, rewrites files, dedupes `assets/icons.jigx`, `--revert` |
| `skills/icon-migration/scripts/review.mjs` | Builds and opens the self-contained review page |
| `skills/icon-migration/scripts/find.mjs` | Searches Tabler names and tags |
| `skills/icon-migration/data/` | Reference mapping, Tabler 3.49.0 outline set, old pictures, names to keep |
| `tests/` | Fixture solution and the end-to-end test |

Run the tests with `node tests/run.mjs`.

Tabler Icons are MIT licensed.
