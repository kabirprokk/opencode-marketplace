#!/usr/bin/env node
"use strict";

const REGISTRY_URL = "https://raw.githubusercontent.com/kabirprokk/opencode-registry/main/registry.json";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");

const CONFIG_DIR = path.join(os.homedir(), ".config", "opencode");
const TYPE_TO_DIR = { skill: "skills", agent: "agents", command: "commands" };
const PACK_DIRS = ["skills", "agents", "commands"];
const MAX_REGISTRY_BYTES = 2 * 1024 * 1024;
const REGISTRY_CACHE_PATH = path.join(os.homedir(), ".cache", "opencode-marketplace", "registry.json");
const REGISTRY_CACHE_TTL_MS = 5 * 60 * 1000;
const REGISTRY_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MANIFEST_PATH = path.join(CONFIG_DIR, ".marketplace", "installed.json");
const OPENCODE_CONFIG_PATH = path.join(CONFIG_DIR, "opencode.json");

function readRegistryCache() {
  try {
    const value = JSON.parse(fs.readFileSync(REGISTRY_CACHE_PATH, "utf8"));
    if (value && typeof value.fetchedAt === "number" && value.registry && Array.isArray(value.registry.packages)) return value;
  } catch {}
  return null;
}

function writeRegistryCache(value) {
  try {
    fs.mkdirSync(path.dirname(REGISTRY_CACHE_PATH), { recursive: true });
    fs.writeFileSync(REGISTRY_CACHE_PATH, JSON.stringify(value), "utf8");
  } catch {
    // A cache is only an optimization; a read-only home directory must not
    // make an otherwise successful registry request fail.
  }
}

function validateRegistry(registry) {
  if (!registry || !Array.isArray(registry.packages)) throw new Error("Registry has an invalid format");
  for (const entry of registry.packages) validateEntry(entry);
  return registry;
}

async function fetchRegistry() {
  const cached = readRegistryCache();
  const age = cached ? Date.now() - cached.fetchedAt : Infinity;
  if (cached && age >= 0 && age < REGISTRY_CACHE_TTL_MS) return validateRegistry(cached.registry);
  try {
    const headers = cached && cached.etag ? { "If-None-Match": cached.etag } : {};
    const response = await fetch(REGISTRY_URL, { headers, signal: AbortSignal.timeout(12000) });
    if (response.status === 304 && cached) {
      cached.fetchedAt = Date.now();
      writeRegistryCache(cached);
      return validateRegistry(cached.registry);
    }
    if (!response.ok) throw new Error(`Registry request failed (HTTP ${response.status})`);
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_REGISTRY_BYTES) throw new Error("Registry exceeds 2 MiB limit");
    const registry = validateRegistry(JSON.parse(text));
    const updated = { fetchedAt: Date.now(), etag: response.headers.get("etag"), registry };
    writeRegistryCache(updated);
    return registry;
  } catch (error) {
    if (cached && age >= 0 && age < REGISTRY_CACHE_MAX_AGE_MS) return validateRegistry(cached.registry);
    throw error;
  }
}

function validateName(name) {
  if (typeof name !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(name) || name === "." || name === "..") {
    throw new Error("Package name is invalid");
  }
}

function validateRepo(repo) {
  let url;
  try { url = new URL(repo); } catch { throw new Error("Package repository URL is invalid"); }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.search || url.hash) {
    throw new Error("Only public HTTPS repositories hosted on github.com are supported");
  }
  if (!/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/.test(url.pathname)) {
    throw new Error("Repository must use the https://github.com/owner/repository URL format");
  }
}

function validateEntry(entry) {
  if (!entry || typeof entry !== "object") throw new Error("Registry contains an invalid package entry");
  validateName(entry.name);
  validateRepo(entry.repo);
  if (!TYPE_TO_DIR[entry.type] && !["skill-pack", "mcp"].includes(entry.type)) throw new Error(`Unsupported package type: ${entry.type}`);
  if (entry.type !== "skill-pack" && entry.path === undefined) throw new Error(`Package ${entry.name} must declare a source path`);
  if (entry.path !== undefined) safeRepoPath("C:\\marketplace-root", entry.path);
  if ([entry.version, entry.description, entry.author, entry.license].some((value) => typeof value !== "string" || !value.trim()) ||
    !Array.isArray(entry.tags) || entry.tags.some((tag) => typeof tag !== "string" || !tag.trim())) {
    throw new Error(`Package ${entry.name} has invalid metadata`);
  }
}

function safeRepoPath(root, relativePath) {
  if (typeof relativePath !== "string" || !relativePath.trim() || path.isAbsolute(relativePath) || /^[A-Za-z]:/.test(relativePath)) {
    throw new Error("Package path must be a non-empty relative path");
  }
  const segments = relativePath.replaceAll("\\", "/").split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) throw new Error("Package path contains an unsafe segment");
  const target = path.resolve(root, ...segments);
  const rel = path.relative(root, target);
  if (!rel || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error("Package path escapes the repository");
  return target;
}

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function loadManifest() {
  try {
    const value = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch { return {}; }
}

function saveManifest(manifest) {
  ensureDir(path.dirname(MANIFEST_PATH));
  const temp = `${MANIFEST_PATH}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  fs.renameSync(temp, MANIFEST_PATH);
}

function updateMcpConfig(name, directory, remove = false) {
  const jsoncPath = path.join(CONFIG_DIR, "opencode.jsonc");
  if (remove && !fs.existsSync(OPENCODE_CONFIG_PATH)) return;
  if (fs.existsSync(jsoncPath) && !fs.existsSync(OPENCODE_CONFIG_PATH)) {
    throw new Error("Found opencode.jsonc; add this MCP manually because OCM will not rewrite JSONC config");
  }
  let config = {};
  if (fs.existsSync(OPENCODE_CONFIG_PATH)) {
    try { config = JSON.parse(fs.readFileSync(OPENCODE_CONFIG_PATH, "utf8")); }
    catch { throw new Error("opencode.json is not valid JSON; refusing to overwrite it"); }
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("opencode.json must contain a JSON object");
  if (config.mcp === undefined) config.mcp = {};
  if (typeof config.mcp !== "object" || Array.isArray(config.mcp)) throw new Error("opencode.json mcp setting must be an object");
  const servers = config.mcp.servers && typeof config.mcp.servers === "object" && !Array.isArray(config.mcp.servers)
    ? config.mcp.servers
    : config.mcp;
  if (remove) {
    const current = servers[name];
    const serverFile = path.join(directory, "server.js");
    if (current && current.cwd === directory && Array.isArray(current.command) && current.command[0] === process.execPath && current.command[1] === serverFile) {
      delete servers[name];
    }
  } else {
    if (Object.prototype.hasOwnProperty.call(servers, name)) throw new Error(`MCP config already exists for ${name}; refusing to overwrite it`);
    servers[name] = { type: "local", command: [process.execPath, path.join(directory, "server.js")], cwd: directory, enabled: true };
    config.permission ??= {};
    if (typeof config.permission !== "object" || Array.isArray(config.permission)) throw new Error("opencode.json permission setting must be an object");
    if (config.permission[`${name}_*`] === undefined) config.permission[`${name}_*`] = "deny";
    config.agent ??= {};
    if (typeof config.agent !== "object" || Array.isArray(config.agent)) throw new Error("opencode.json agent setting must be an object");
    config.agent["mcp-tools"] ??= {
      description: "Primary agent with access to installed MCP tools.",
      mode: "primary",
      prompt: "Use configured MCP tools when they help with the user request.",
      permission: {},
    };
    if (typeof config.agent["mcp-tools"] !== "object" || Array.isArray(config.agent["mcp-tools"])) throw new Error("opencode.json mcp-tools agent must be an object");
    config.agent["mcp-tools"].permission ??= {};
    if (typeof config.agent["mcp-tools"].permission !== "object" || Array.isArray(config.agent["mcp-tools"].permission)) throw new Error("mcp-tools agent permission setting must be an object");
    config.agent["mcp-tools"].permission[`${name}_*`] = "allow";
  }
  const temp = `${OPENCODE_CONFIG_PATH}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  fs.renameSync(temp, OPENCODE_CONFIG_PATH);
}

function installMcp(item, clonePath) {
  const source = safeRepoPath(clonePath, item.path);
  const destination = path.join(CONFIG_DIR, "mcp", item.name);
  if (fs.existsSync(destination)) throw new Error(`Already installed: ${destination}`);
  if (fs.existsSync(path.join(CONFIG_DIR, "opencode.jsonc")) && !fs.existsSync(OPENCODE_CONFIG_PATH)) {
    throw new Error("Found opencode.jsonc; add this MCP manually because OCM will not rewrite JSONC config");
  }
  const configFile = path.join(CONFIG_DIR, "opencode.json");
  if (fs.existsSync(configFile)) {
    let config;
    try { config = JSON.parse(fs.readFileSync(configFile, "utf8")); }
    catch { throw new Error("opencode.json is not valid JSON; refusing to overwrite it"); }
    const servers = config.mcp?.servers && typeof config.mcp.servers === "object" ? config.mcp.servers : config.mcp;
    if (servers && Object.prototype.hasOwnProperty.call(servers, item.name)) throw new Error(`MCP config already exists for ${item.name}; refusing to overwrite it`);
  }
  stageAndInstall(source, destination);
  try {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const result = spawnSync(npm, ["ci", "--omit=dev", "--no-audit", "--no-fund"], {
      cwd: destination, encoding: "utf8", timeout: 120000, windowsHide: true, maxBuffer: 1024 * 1024,
      shell: process.platform === "win32",
    });
    if (result.error) throw new Error(`Could not install MCP dependencies: ${result.error.message}`);
    if (result.status !== 0) throw new Error((result.stderr || "npm ci failed").trim());
    updateMcpConfig(item.name, destination);
    return destination;
  } catch (error) {
    fs.rmSync(destination, { recursive: true, force: true });
    throw error;
  }
}

function copyTreeSafe(source, destination) {
  const info = fs.lstatSync(source);
  if (info.isSymbolicLink()) throw new Error(`Refusing symbolic link in package: ${source}`);
  if (info.isDirectory()) {
    ensureDir(destination);
    for (const name of fs.readdirSync(source)) {
      if (name === ".git") continue;
      copyTreeSafe(path.join(source, name), path.join(destination, name));
    }
    return;
  }
  if (!info.isFile()) throw new Error(`Refusing special file in package: ${source}`);
  ensureDir(path.dirname(destination));
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
}

function cmdList(registry) {
  console.log("\nOpenCode Community Marketplace\n");
  console.log("NAME".padEnd(24) + "TYPE".padEnd(14) + "VERSION".padEnd(10) + "DESCRIPTION");
  console.log("-".repeat(88));
  for (const item of registry.packages) {
    console.log(item.name.padEnd(24) + item.type.padEnd(14) + String(item.version || "-").padEnd(10) + item.description.slice(0, 50));
  }
  console.log(`\n${registry.packages.length} packages. Use 'ocm search <query>' or 'ocm install <name>'.\n`);
}

function cmdSearch(registry, query) {
  const q = query.trim().toLocaleLowerCase();
  const results = registry.packages.filter((item) =>
    [item.name, item.description, item.author, ...item.tags].some((value) => value.toLocaleLowerCase().includes(q)),
  );
  if (!results.length) return console.log(`\nNo packages matching "${query}".\n`);
  console.log(`\nSearch results for "${query}":\n`);
  for (const item of results) console.log(`${item.name} (${item.type}) v${item.version} - ${item.description}`);
  console.log();
}

function cmdInfo(registry, name) {
  const item = registry.packages.find((candidate) => candidate.name === name);
  if (!item) throw new Error(`Package not found: ${name || "(missing name)"}`);
  console.log(`\n${item.name}\n${"=".repeat(item.name.length)}\nType:        ${item.type}\nVersion:     ${item.version}\nAuthor:      ${item.author}\nLicense:     ${item.license}\nTags:        ${item.tags.join(", ")}\nDescription: ${item.description}\nRepository:  ${item.repo}${item.path ? `\nPath:        ${item.path}` : ""}\n`);
}

function cloneRepo(repo, destination) {
  const result = spawnSync("git", ["clone", "--depth", "1", repo, destination], {
    encoding: "utf8",
    timeout: 120000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  if (result.error) throw new Error(`Could not run git clone: ${result.error.message}`);
  if (result.status !== 0) throw new Error((result.stderr || "git clone failed").trim());
}

function stageAndInstall(source, destination) {
  if (fs.existsSync(destination)) throw new Error(`Already installed: ${destination}`);
  const stage = path.join(path.dirname(destination), `.${path.basename(destination)}.install-${randomUUID()}`);
  try {
    copyTreeSafe(source, stage);
    fs.renameSync(stage, destination);
  } catch (error) {
    fs.rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}

function installPackage(registry, name) {
  validateName(name);
  const item = registry.packages.find((candidate) => candidate.name === name);
  if (!item) throw new Error(`Package not found: ${name}`);
  validateEntry(item);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-market-") );
  const clonePath = path.join(tempRoot, "source");
  const installedPaths = [];
  try {
    console.log(`\nInstalling ${item.name} (${item.type}) from ${item.repo}`);
    console.log("Community content is unreviewed. Inspect it before trusting its instructions.");
    cloneRepo(item.repo, clonePath);

    if (item.type === "mcp") {
      installedPaths.push(installMcp(item, clonePath));
    } else if (item.type === "skill-pack") {
      for (const directory of PACK_DIRS) {
        const sourceDir = path.join(clonePath, directory);
        if (!fs.existsSync(sourceDir)) continue;
        for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
          if (!entry.isDirectory() && !entry.isFile()) continue;
          if (directory === "skills" && !entry.isDirectory()) continue;
          if (directory !== "skills" && (!entry.isFile() || !entry.name.endsWith(".md"))) continue;
          validateName(entry.name);
          const source = path.join(sourceDir, entry.name);
          const destination = path.join(CONFIG_DIR, directory, entry.name);
          if (fs.existsSync(destination)) {
            console.log(`Skipped existing ${directory}/${entry.name}`);
            continue;
          }
          ensureDir(path.dirname(destination));
          stageAndInstall(source, destination);
          installedPaths.push(destination);
        }
      }
      if (!installedPaths.length) throw new Error("No installable skills, agents, or commands were found in this repository");
    } else {
      const source = item.path ? safeRepoPath(clonePath, item.path) : clonePath;
      const filename = item.type === "skill" ? item.name : `${item.name}.md`;
      const destination = path.join(CONFIG_DIR, TYPE_TO_DIR[item.type], filename);
      ensureDir(path.dirname(destination));
      stageAndInstall(source, destination);
      installedPaths.push(destination);
    }

    const manifest = loadManifest();
    manifest[item.name] = installedPaths.map((installPath) => path.relative(CONFIG_DIR, installPath));
    saveManifest(manifest);
    for (const installPath of installedPaths) console.log(`Installed: ${installPath}`);
    console.log();
  } catch (error) {
    for (const installPath of installedPaths) {
      if (item.type === "mcp") {
        try { updateMcpConfig(item.name, installPath, true); } catch {}
      }
      fs.rmSync(installPath, { recursive: true, force: true });
    }
    throw error;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function cmdRemove(name) {
  validateName(name);
  const manifest = loadManifest();
  const paths = manifest[name];
  if (!Array.isArray(paths)) {
    console.log(`\n${name} is not recorded as installed by this CLI; refusing to remove untracked files.\n`);
    return;
  }
  let removed = 0;
  for (const relativePath of paths) {
    const target = safeRepoPath(CONFIG_DIR, relativePath);
    if (relativePath.replaceAll("\\", "/").startsWith("mcp/")) {
      try { updateMcpConfig(name, target, true); } catch (error) { console.error(`Could not remove MCP config: ${error.message}`); }
    }
    if (!fs.existsSync(target)) continue;
    fs.rmSync(target, { recursive: true, force: true });
    console.log(`Removed: ${target}`);
    removed++;
  }
  delete manifest[name];
  saveManifest(manifest);
  if (!removed) console.log(`\n${name} is not installed.\n`);
}

function printHelp() {
  console.log(`\nOpenCode Community Marketplace CLI (ocm)\n\nUsage:\n  ocm list\n  ocm search <query>\n  ocm info <name>\n  ocm install <name>\n  ocm remove <name>\n\nSkills, agents, and commands are copied into ~/.config/opencode/.\nMCP servers are installed locally and added to opencode.json.\nSkill packs install each available skill, agent, and command without overwriting existing files.\nReview community content before using it.\n\nRegistry: ${REGISTRY_URL}\n`);
}

async function main(args = process.argv.slice(2)) {
  const command = args[0];
  if (!command || command === "help" || command === "--help" || command === "-h") return printHelp();
  if (command === "remove" || command === "rm") return cmdRemove(args[1]);

  const registry = await fetchRegistry();
  switch (command) {
    case "list": case "ls": return cmdList(registry);
    case "search": case "s": return cmdSearch(registry, args.slice(1).join(" "));
    case "info": return cmdInfo(registry, args[1]);
    case "install": case "i": return installPackage(registry, args[1]);
    default: throw new Error(`Unknown command: ${command}. Run 'ocm help'.`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nError: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { fetchRegistry, validateName, validateRepo, validateEntry, safeRepoPath, copyTreeSafe, installPackage, cmdRemove, main };
