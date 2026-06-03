---
name: obsidian
description: Create Obsidian-vault-ready Markdown notes for this Fifa project. Use when the user says "obsidian update", "vault note", "status note", "sync to obsidian", or wants to log a status snapshot, finding, or decision into their Obsidian vault. Drops a frontmattered file into docs/obsidian/ and (by default) git commits + pushes it so the vault can pull via git-sync or symlink.
---

# Obsidian — Vault-ready notes from this repo

This project's Obsidian vault lives on the user's local machine, so this
container cannot write to it directly. The pattern is: produce a properly
frontmattered Markdown note in `docs/obsidian/`, commit + push it, and the
user syncs by symlinking that folder into their vault (or `git pull`-ing).

The driver `new-note.mjs` does all of that in one shot.

## Run (agent path)

All paths relative to the repo root (`/home/user/Fifa` in this container).

Body comes from **stdin**. Tags `fifa`, `worldcup`, `claude-code` are added
automatically; pass extras via `--tags=`.

```bash
echo "## Whatever markdown body

- bullet
- bullet" | node .claude/skills/obsidian/new-note.mjs "My Note Title" --tags=status,live
```

Output: writes `docs/obsidian/<slug>-YYYY-MM-DD.md`, then `git add` + `git commit` + `git push -u origin <current-branch>`. Prints the resulting path.

### Flags

| Flag | Default | Effect |
|---|---|---|
| `--tags=a,b,c` | `[]` | Extra tags merged onto the always-present `fifa, worldcup, claude-code`. |
| `--slug=<slug>` | `<slugified-title>-<YYYY-MM-DD>` | Override the auto-slug (filename without `.md`). |
| `--no-commit` | commit on | Just write the file, don't `git add/commit`. Implies `--no-push`. |
| `--no-push` | push on | Commit but don't push. Useful while iterating. |
| `--dir=<path>` | `docs/obsidian` | Override output dir (relative to repo root). |

### Frontmatter shape

```yaml
---
title: My Note Title
date: 2026-06-03
tags: [fifa, worldcup, claude-code, status, live]
project: fifa-orpin
prod-url: https://fifa-orpin.vercel.app
repo: awe420some/fifa
---
```

### Overwrite protection

If the target file already exists, the driver exits with code 1 and prints
the conflicting path. Pass `--slug=<unique-slug>` to write a sibling note
rather than clobbering the existing one.

## How the user actually syncs

One-time setup on the user's machine (not in this container):

```bash
# inside their vault
ln -s /path/to/Fifa/docs/obsidian Fifa-Status
```

Then any commit landing on the dev branch shows up in their vault after
`git pull`. No special Obsidian plugin needed.

## Gotchas

- **Don't put secrets in notes.** This commits to a public-ish repo. The
  frontmatter `repo:` field is a reminder, not a gate — review the body
  before letting the driver commit.
- **Filename collisions on same-day, same-title runs** are blocked by the
  overwrite check. Real failure mode: writing two status notes the same
  day with the same title. Fix with `--slug=`.
- **Push may fail** if the branch doesn't track a remote yet. The driver
  uses `git push -u origin <branch>` which sets upstream on first push,
  so that's usually fine; if it still fails (e.g. permission), the file
  is already committed locally — push manually after fixing.
- **Stdin must be piped or redirected.** Running `node new-note.mjs "X"`
  in an interactive TTY would block on stdin; pass `< /dev/null` for an
  intentional stub note (the driver writes "Stub — fill me in.").

## Troubleshooting

| Symptom | Fix |
|---|---|
| `refuse to overwrite existing file` | Pass `--slug=<unique>` or delete the old file if you really meant to replace it. |
| `usage: new-note.mjs <title>` | Title arg is mandatory and must be quoted if it has spaces. |
| Driver writes file but no commit | Check if `--no-commit` slipped in, or run `git status` — the file is on disk. |
| Push failed | The commit is locally safe. Run `git push -u origin $(git branch --show-current)` manually. |
