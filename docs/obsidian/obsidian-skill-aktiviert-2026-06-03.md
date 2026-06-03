---
title: Obsidian-Skill aktiviert
date: 2026-06-03
tags: [fifa, worldcup, claude-code, meta, skill]
project: fifa-orpin
prod-url: https://fifa-orpin.vercel.app
repo: awe420some/fifa
---

# Obsidian-Skill aktiviert

## Was

Ein neues `/obsidian`-Skill liegt jetzt im Repo unter `.claude/skills/obsidian/`.
Driver: `new-note.mjs`. SKILL.md erklärt die Verwendung.

## Warum

Damit zukünftige Claude-Sessions auf "obsidian update" / "status note" /
"vault note" automatisch den richtigen Workflow anwerfen: Frontmatter
generieren, in `docs/obsidian/` ablegen, committen, pushen.

## Wie verwendet

```bash
echo "body markdown" | node .claude/skills/obsidian/new-note.mjs "Titel" --tags=foo,bar
```

## Selbsttest

Diese Note hier wurde mit dem Skill selbst erzeugt.
