---
name: icon-migration
description: Migrate a Jigx solution's icons from Streamline names to Tabler Icons 3.49.0 (outline). Use when asked to migrate icons, switch a solution to Tabler, run /icon-migration, or apply icon changes copied from the icon migration review page.
---

# Jigx icon migration (Streamline → Tabler)

Rename every icon in one Jigx solution from a Streamline name to a Tabler Icons 3.49.0
outline name. Change icon names only, nothing else. Scripts do the finding, validating
and rewriting; you make the choices the scripts cannot.

Scripts live in `scripts/` next to this file. Run them with Node 18+ and pass the solution
folder (the folder with `index.jigx`). All working files go to `<solution>/.icon-migration/`.

```bash
SKILL=<this skill's folder>
node "$SKILL/scripts/scan.mjs" <solution>
```

## Before you start

1. Check `node -v` is 18 or newer. If Node is missing, stop and tell the user to install it
   (https://nodejs.org).
2. Confirm the folder is a Jigx solution (`index.jigx` at its root). If the user has several
   solutions, migrate one at a time.
3. If the folder is a git repo with uncommitted changes, mention it so they can commit first.
   The migration can be undone either way (see Undo). `scan.mjs` adds `.icon-migration/` to
   the repo's local `.git/info/exclude`, because that folder holds full copies of the original
   files. Tell the user if the solution is not in git, so they keep that folder out of any
   upload.

## 1. Scan

Run `scan.mjs <solution>`. It writes `.icon-migration/scan.json` and a `decisions.json`
skeleton, and prints a summary:

- **mapped**: old names in the shared reference mapping. Already decided. Do not second-guess
  them; that keeps every solution consistent.
- **pending**: old names the mapping does not cover. You choose (step 2).
- **maybe**: places where a string could be an icon but sits outside an icon key (SQL, data,
  helper code, odd expression strings). You decide "icon" or "skip".
- **dynamic**: icon values computed from data with no literal name in the files.
- **fromData**: icon columns read from tables with `json_extract(data, '$.icon')`, labelled
  Dynamic Data when the table is declared as `null` in `databases/default.jigx`. These are
  pre-filled into `decisions.json`.
- **unchanged**: names that are already valid Tabler names. Left as they are.

Strings set on icon-like keys of inline data (`"icon": "…"`, `"righticon": "…"`) and on
properties that icon expressions read (`icon: =@ctx.current.item.righticon`) count as icons.

Flags (`us`, `gb`, …), `start-marker`, `end-marker`, `jigx-solid` and the placeholder
animations (`loading-data`, `missing-data`, `is-offline`, `oil-drop`, `helicopter`,
`scan-qr`) are never touched.

## 2. Fill in decisions.json

Edit `.icon-migration/decisions.json`. Read each entry's places in `scan.json` (`where`:
file, line, the line's text and the label shown next to the icon).

### choices — one per pending name

```json
"server-network": {
  "new": "server-2",
  "alternatives": ["server", "network"],
  "confidence": "check",
  "note": "Old picture is two stacked servers with a cable"
}
```

- **Look at the old picture before choosing.** Download
  `https://images.jigx.com/icons/{first two letters}/{name}.svg` (for example
  `https://images.jigx.com/icons/se/server-network.svg`) and read its paths. Read the label
  and the screen it is on. Choose by what the picture and label mean, not by the spelling.
- Search the bundled list with `node "$SKILL/scripts/find.mjs" <word> [<word> ...]`. It
  matches names and Tabler tags. Browse visually at https://tabler.io/icons if needed.
- Merge only true variants: names that differ by a number or `-alternate` suffix are the
  same picture and get the same Tabler name. Never put two different meanings on one Tabler
  name (for example sync vs retry, services vs logs). Pick distinct icons and say so in the
  report.
- Prefer the plain base icon (`clock`, not `clock-hour-4`) unless the variant carries meaning.
- Never use names ending in `-filled`; the app ships the outline set only.
- `alternatives`: 2 or 3 other valid names that would also fit, so the reviewer can switch
  with one click.
- `confidence`: `"high"` when the match is clear, `"check"` when it is approximate.

### maybe — one per place

Set each id to `"icon"` when the string feeds an icon property (for example a SQL `CASE`
that returns the icon column, or a JS helper that returns an icon name), otherwise `"skip"`.
If you mark an unknown name as `"icon"`, also add it to `choices`. Names that are already
valid Tabler icons stay as they are, whichever you choose.

### extra — places the scan missed

If you find an old icon name the scan did not list, add its position instead of editing the
file by hand (hand edits make the next apply refuse):

```json
"extra": [{ "file": "scripts/helpers.js", "line": 42, "name": "server-network" }]
```

`col` is optional; without it the first whole-word match on that line is used. Mapped names
get their reference pick; any other name needs a `choices` entry. Line numbers refer to the
files as they were before the migration.

### notMigrated and fromData

- `notMigrated`: icon names you found but could not rewrite safely, for example a name built
  by string concatenation. `{ "name", "file", "line", "reason" }`.
- `fromData`: icon values that come from a database, REST datasource or other external data,
  so the values must be updated at the source. Table reads are pre-filled; also go through
  the **dynamic** list in `scan.json` and trace each expression to its datasource.
  `{ "source", "file", "line" }`.

You may also add `choices` for mapped names, but only when the user asks for a different
pick (see step 5). Leave `oldSvg` out; the review page fetches old pictures itself.

## 3. Apply

Run `apply.mjs <solution>`. It validates every name against the bundled Tabler 3.49.0
outline list, rewrites only the recorded positions, removes duplicates from
`assets/icons.jigx` and writes `.icon-migration/icon-migration.json`.

If it lists problems, fix `decisions.json` and run it again. It always rebuilds from the
pristine copies in `.icon-migration/original/`, so running it again is safe. It refuses to
overwrite a file the user changed after the last apply; ask before passing `--force`.

Then run `verify.mjs <solution>`. It scans the current files and lists old or invalid names
still in icon positions; it ignores `.icon-migration/` and ordinary strings that merely look
like icon names. Fix anything it lists through `extra` or `choices` and apply again. Do not
grep for leftovers by hand.

## 4. Open the review

Run `review.mjs <solution>`. It builds `.icon-migration/review.html` with everything built
in and opens it in the browser. Then report briefly in chat:

- Totals: files changed, icon uses changed, old names migrated.
- The `check` rows only: old → new, one reason each (apply prints them with their notes).
- Merges you avoided and the duplicates removed from `assets/icons.jigx`.
- `notMigrated` and `fromData`.

Do not print the full table; it is on the page. Tell the user: "The review page is open.
Change any pick you don't like, then press **Copy changes for the agent** and paste the
result here."

## 5. Apply review changes

The user pastes lines like `- cloud-clock: cloud-pause -> cloud-upload`. For each line set
`decisions.choices["cloud-clock"].new` to the name after the arrow (keep the entry's other
fields, create it if missing). Then run `apply.mjs` and `review.mjs` again.

## 6. Finish

When the user is happy:

1. Delete the `.icon-migration` folder. It holds the pristine copies used for undo, so only
   delete it once they are done. Never publish it.
2. Publish the solution and open it in the app. Any icon still shown as a red question mark
   is a name Tabler does not have.

## Undo

`apply.mjs <solution> --revert` restores every changed file from `.icon-migration/original/`.
Run `scan.mjs` again afterwards to start over.
