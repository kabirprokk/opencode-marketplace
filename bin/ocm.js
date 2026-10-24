#!/usr/bin/env node
const REGISTRY_URL = "https://raw.githubusercontent.com/kabirprokk/opencode-registry/main/registry.json";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const CONFIG_DIR = path.join(os.homedir(), ".config", "opencode");
const TYPE_TO_DIR = {
  skill: "skills",
  "skill-pack": "skills",
  agent: "agents",
  command: "commands",
};

function fetchRegistry() {
  // Use curl or fetch (Node 18+)
  try {
    const https = require("https");
    return new Promise((resolve, reject) => {
      https.get(REGISTRY_URL, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
      }).on("error", reject);
    });
  } catch (e) {
    console.error("Failed to fetch registry:", e.message);
    process.exit(1);
  }
}

function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function cmdList(reg) {
  console.log("\n  OpenCode Marketplace\n");
  console.log("  " + "NAME".padEnd(22) + "TYPE".padEnd(12) + "VERSION".padEnd(10) + "DESCRIPTION");
  console.log("  " + "-".repeat(80));
  for (const p of reg.packages) {
    console.log("  " + p.name.padEnd(22) + p.type.padEnd(12) + (p.version || "-").padEnd(10) + (p.description || "").slice(0, 50));
  }
  console.log(`\n  ${reg.packages.length} packages available. Use 'ocm search <query>' or 'ocm install <name>'.\n`);
}

function cmdSearch(reg, query) {
  const q = query.toLowerCase();
  const results = reg.packages.filter((p) =>
    p.name.toLowerCase().includes(q) ||
    (p.description || "").toLowerCase().includes(q) ||
    (p.tags || []).some((t) => t.toLowerCase().includes(q))
  );
  if (results.length === 0) { console.log(`\n  No packages matching "${query}".\n`); return; }
  console.log(`\n  Search results for "${query}":\n`);
  for (const p of results) {
    console.log(`  ${p.name} (${p.type}) v${p.version} — ${p.description}`);
  }
  console.log();
}

function cmdInfo(reg, name) {
  const p = reg.packages.find((x) => x.name === name);
  if (!p) { console.log(`\n  Package "${name}" not found.\n`); return; }
  console.log("\n  " + p.name);
  console.log("  " + "=".repeat(p.name.length));
  console.log(`  Type:        ${p.type}`);
  console.log(`  Version:     ${p.version}`);
  console.log(`  Author:      ${p.author}`);
  console.log(`  License:     ${p.license}`);
  console.log(`  Tags:        ${(p.tags || []).join(", ")}`);
  console.log(`  Description: ${p.description}`);
  console.log(`  Repo:        ${p.repo}`);
  if (p.path) console.log(`  Path:        ${p.path}`);
  console.log();
}

function cmdInstall(reg, name) {
  const p = reg.packages.find((x) => x.name === name);
  if (!p) { console.log(`\n  Package "${name}" not found.\n`); return; }
  const dir = TYPE_TO_DIR[p.type];
  if (!dir) { console.log(`\n  Unknown package type: ${p.type}\n`); return; }
  const targetDir = path.join(CONFIG_DIR, dir);
  ensureDir(targetDir);
  const dest = path.join(targetDir, name);
  if (fs.existsSync(dest)) {
    console.log(`\n  ${name} is already installed at ${dest}. Use 'ocm remove ${name}' first to reinstall.\n`);
    return;
  }
  console.log(`\n  Installing ${name} (${p.type})...`);
  try {
    if (p.install === "git") {
      const cloneUrl = p.repo;
      const cloneCmd = p.path
        ? `git clone --depth 1 --filter=blob:none --sparse ${cloneUrl} ${dest} && cd ${dest} && git sparse-checkout set ${p.path}`
        : `git clone --depth 1 ${cloneUrl} ${dest}`;
      execSync(cloneCmd, { stdio: "inherit" });
      // If path specified, move contents up
      if (p.path) {
        const srcPath = path.join(dest, p.path);
        if (fs.existsSync(srcPath)) {
          const tmpDir = dest + ".tmp";
          fs.renameSync(srcPath, tmpDir);
          // remove dest contents except .git
          for (const f of fs.readdirSync(dest)) {
            if (f === ".git") continue;
            const fp = path.join(dest, f);
            fs.rmSync(fp, { recursive: true, force: true });
          }
          for (const f of fs.readdirSync(tmpDir)) {
            fs.renameSync(path.join(tmpDir, f), path.join(dest, f));
          }
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      }
    }
    console.log(`\n  ✓ Installed ${name} to ${dest}\n`);
  } catch (e) {
    console.error(`\n  ✗ Failed to install ${name}: ${e.message}\n`);
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  }
}

function cmdRemove(name) {
  // Find in any config dir
  let found = false;
  for (const dir of Object.values(TYPE_TO_DIR)) {
    const dest = path.join(CONFIG_DIR, dir, name);
    if (fs.existsSync(dest)) {
      fs.rmSync(dest, { recursive: true, force: true });
      console.log(`\n  ✓ Removed ${name} from ${dest}\n`);
      found = true;
    }
  }
  if (!found) console.log(`\n  ${name} is not installed.\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const reg = await fetchRegistry();

  switch (cmd) {
    case "list": case "ls": cmdList(reg); break;
    case "search": case "s": cmdSearch(reg, args[1] || ""); break;
    case "info": cmdInfo(reg, args[1]); break;
    case "install": case "i": cmdInstall(reg, args[1]); break;
    case "remove": case "rm": cmdRemove(args[1]); break;
    case "help": case undefined:
      console.log(`
  OpenCode Marketplace CLI (ocm)

  Usage:
    ocm list              List all available packages
    ocm search <query>    Search packages
    ocm info <name>       Show package details
    ocm install <name>    Install a package
    ocm remove <name>     Remove an installed package

  Registry: ${REGISTRY_URL}
`);
      break;
    default:
      console.error(`\n  Unknown command: ${cmd}. Run 'ocm help' for usage.\n`);
      process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
