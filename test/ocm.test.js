"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { validateName, validateRepo, validateEntry, safeRepoPath, copyTreeSafe } = require("../bin/ocm.js");

test("accepts normal package names and rejects traversal", () => {
  assert.doesNotThrow(() => validateName("osien-3d-forge"));
  assert.throws(() => validateName("../outside"), /invalid/);
  assert.throws(() => validateName("x".repeat(65)), /invalid/);
});

test("rejects malformed metadata before CLI commands consume it", () => {
  const valid = {
    name: "example", type: "skill", version: "1.0.0", description: "Example skill",
    author: "author", license: "MIT", repo: "https://github.com/owner/repository",
    path: "skills/example", install: "git", tags: ["example"],
  };
  assert.doesNotThrow(() => validateEntry(valid));
  assert.doesNotThrow(() => validateEntry({ ...valid, name: "example-mcp", type: "mcp", path: "mcp-server" }));
  for (const invalid of [
    { ...valid, author: 5 },
    { ...valid, version: null },
    { ...valid, license: {} },
    { ...valid, tags: [123] },
  ]) assert.throws(() => validateEntry(invalid), /invalid metadata/);
});

test("only accepts exact public GitHub HTTPS repositories", () => {
  assert.doesNotThrow(() => validateRepo("https://github.com/owner/repository"));
  assert.doesNotThrow(() => validateRepo("https://github.com/owner/repository.git"));
  assert.throws(() => validateRepo("https://github.com.evil.test/owner/repository"), /github.com/);
  assert.throws(() => validateRepo("http://github.com/owner/repository"), /github.com/);
});

test("repository paths cannot escape or select the repository root", () => {
  const root = path.resolve("marketplace-test-root");
  assert.equal(safeRepoPath(root, "skills/thing"), path.join(root, "skills", "thing"));
  assert.throws(() => safeRepoPath(root, "../outside"), /unsafe/);
  assert.throws(() => safeRepoPath(root, "skills/../outside"), /unsafe/);
  assert.throws(() => safeRepoPath(root, "skills//thing"), /unsafe/);
});

test("safe package copy preserves files and refuses symbolic links", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ocm-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  const destination = path.join(root, "destination");
  fs.mkdirSync(path.join(source, "nested"), { recursive: true });
  fs.writeFileSync(path.join(source, "nested", "SKILL.md"), "safe text");
  copyTreeSafe(source, destination);
  assert.equal(fs.readFileSync(path.join(destination, "nested", "SKILL.md"), "utf8"), "safe text");

  const linkSource = path.join(root, "link-source");
  fs.mkdirSync(linkSource);
  try {
    fs.symlinkSync(path.join(source, "nested"), path.join(linkSource, "linked"), "junction");
  } catch {
    t.skip("This Windows environment does not permit creating a junction");
    return;
  }
  assert.throws(() => copyTreeSafe(linkSource, path.join(root, "unsafe-copy")), /symbolic link/);
});
