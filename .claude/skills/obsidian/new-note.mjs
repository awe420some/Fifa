#!/usr/bin/env node
// Obsidian vault-ready note generator for the Fifa project.
//
// Usage:
//   echo "# Body markdown" | node .claude/skills/obsidian/new-note.mjs <title> [opts]
//
// Options:
//   --tags=a,b,c      extra tags (always prepended: fifa, worldcup, claude-code)
//   --slug=<slug>     override auto-slug (default: slugified title + ISO date)
//   --no-commit       skip git add + commit (default: commit)
//   --no-push         skip git push (default: push if branch tracks remote)
//   --dir=<path>      output dir (default: docs/obsidian)
//
// Reads the note body from stdin. If stdin is empty, writes a 1-line stub.
// If the body itself starts with a YAML frontmatter block, that block is
// stripped so we don't emit two frontmatter blocks in a row.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";

const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const args = process.argv.slice(2);
const opts = { tags: [], slug: null, commit: true, push: true, dir: "docs/obsidian" };
let title = null;

for (const a of args) {
  if (a === "--no-commit") opts.commit = false;
  else if (a === "--no-push") opts.push = false;
  else if (a.startsWith("--tags=")) opts.tags = a.slice(7).split(",").map(s => s.trim()).filter(Boolean);
  else if (a.startsWith("--slug=")) opts.slug = a.slice(7);
  else if (a.startsWith("--dir=")) opts.dir = a.slice(6);
  else if (!a.startsWith("--") && !title) title = a;
}

if (!title) {
  console.error("usage: new-note.mjs <title> [--tags=...] [--no-commit] [--no-push] [--dir=...]");
  process.exit(2);
}

const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const slugify = (s) => s.toLowerCase()
  .replace(/[äöüß]/g, (c) => ({ "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss" }[c]))
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");
// Fallback to `note-<date>` when slugify yields nothing (e.g. title is "???"
// or all-non-ASCII), so we never emit `-2026-06-03.md` or `.md`.
const baseSlug = slugify(title) || "note";
const slug = opts.slug || `${baseSlug}-${today}`;

const tags = ["fifa", "worldcup", "claude-code", ...opts.tags];

let body = "";
if (!process.stdin.isTTY) {
  body = readFileSync(0, "utf8");
}
// Strip a leading YAML frontmatter block (`---\n...\n---\n`) so we don't
// emit two frontmatter blocks; the second is silently dropped by Dataview.
body = body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
if (!body.trim()) {
  body = `> Stub — fill me in.\n`;
}

// YAML-safe scalar quoting via JSON.stringify — any JSON string is valid
// YAML, so titles with `:`, `"`, `#`, brackets, or leading sigils are
// preserved exactly without breaking the frontmatter parse.
const yamlScalar = (s) => JSON.stringify(String(s));

const frontmatter = [
  "---",
  `title: ${yamlScalar(title)}`,
  `date: ${today}`,
  `tags: [${tags.map(yamlScalar).join(", ")}]`,
  `project: fifa-orpin`,
  `prod-url: https://fifa-orpin.vercel.app`,
  `repo: awe420some/fifa`,
  "---",
  "",
  `# ${title}`,
  "",
  body.trim(),
  "",
].join("\n");

const outDir = resolve(REPO_ROOT, opts.dir);
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `${slug}.md`);

if (existsSync(outPath)) {
  console.error(`refuse to overwrite existing file: ${outPath}`);
  console.error(`pass --slug=<unique-slug> if intentional`);
  process.exit(1);
}

writeFileSync(outPath, frontmatter);
console.log(`wrote ${outPath}`);

if (opts.commit) {
  const rel = outPath.slice(REPO_ROOT.length + 1);
  // Array-form spawn: no shell, no interpolation, no command injection.
  // `--` separator + explicit path keeps the commit limited to this file,
  // ignoring any unrelated changes the user had pre-staged in the index.
  const gitOpts = { cwd: REPO_ROOT, stdio: "inherit" };
  execFileSync("git", ["add", "--", rel], gitOpts);
  const msg = `docs(obsidian): add note ${slug}`;
  execFileSync("git", ["commit", "-m", msg, "--", rel], gitOpts);
  console.log(`committed ${rel}`);

  if (opts.push) {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
    try {
      execFileSync("git", ["push", "-u", "origin", branch], gitOpts);
      console.log(`pushed to origin/${branch}`);
    } catch (e) {
      console.error(`push failed (commit is local): ${e.message}`);
    }
  }
}
