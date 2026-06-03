#!/usr/bin/env node
// Obsidian vault-ready note generator for the Fifa project.
//
// Usage:
//   echo "# Body markdown" | node .claude/skills/obsidian/new-note.mjs <title> [opts]
//
// Options:
//   --tags=a,b,c      extra tags (always prepended: fifa, worldcup)
//   --slug=<slug>     override auto-slug (default: slugified title + ISO date)
//   --no-commit       skip git add + commit (default: commit)
//   --no-push         skip git push (default: push if branch tracks remote)
//   --dir=<path>      output dir (default: docs/obsidian)
//
// Reads the note body from stdin. If stdin is empty, writes a 1-line stub.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, join } from "node:path";

const REPO_ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
const args = process.argv.slice(2);
const opts = { tags: [], commit: true, push: true, dir: "docs/obsidian" };
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
const slug = opts.slug || `${slugify(title)}-${today}`;

const tags = ["fifa", "worldcup", "claude-code", ...opts.tags];

let body = "";
if (!process.stdin.isTTY) {
  body = readFileSync(0, "utf8");
}
if (!body.trim()) {
  body = `> Stub — fill me in.\n`;
}

const frontmatter = [
  "---",
  `title: ${title}`,
  `date: ${today}`,
  `tags: [${tags.join(", ")}]`,
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
  execSync(`git add ${JSON.stringify(rel)}`, { cwd: REPO_ROOT, stdio: "inherit" });
  const msg = `docs(obsidian): add note ${slug}`;
  execSync(`git commit -m ${JSON.stringify(msg)}`, { cwd: REPO_ROOT, stdio: "inherit" });
  console.log(`committed ${rel}`);

  if (opts.push) {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
    try {
      execSync(`git push -u origin ${branch}`, { cwd: REPO_ROOT, stdio: "inherit" });
      console.log(`pushed to origin/${branch}`);
    } catch (e) {
      console.error(`push failed (continuing): ${e.message}`);
    }
  }
}
