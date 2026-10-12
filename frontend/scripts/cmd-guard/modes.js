// The three entry modes of the command guard.
// runArgs: shim mode -> exit 0 allow / 1 block (reason + alternate on stderr).
// runPreinstall: yarn lifecycle hook -> checks package.json deps against the list.
// runListCommands: print guarded binary names (drives sync-shims.sh).

const fs = require("fs");
const path = require("path");
const { loadRules, maybeLogSource } = require("./rules");
const { firstMatch, listBinaries } = require("./matcher");

// "$1" in reason/alternate is replaced with the blocked command's binary (first word).
function printBlock(subject, entry) {
  const bin = subject.split(" ")[0];
  console.error("");
  console.error(`Blocked: ${subject}`);
  if (entry.reason) console.error(`  Reason:      ${entry.reason.replace(/\$1/g, bin)}`);
  if (entry.alternate) console.error(`  Use instead: ${entry.alternate.replace(/\$1/g, bin)}`);
  console.error("");
}

function runArgs(cmd, args) {
  const { list, source } = loadRules();
  maybeLogSource(list, source);

  const subject = [cmd, ...args].join(" ").trim();
  const hit = firstMatch(list, subject);
  if (!hit || hit.entry.allowed) process.exit(0);
  printBlock(subject, hit.entry);
  process.exit(1);
}

// A dep in package.json is equivalent to having installed it via the one legit path
// (`yarn expo install`, since `yarn add` is blanket-blocked). Each dep is checked as
// that command, so editing package.json directly can't bypass the rules.
const INSTALL_FORM = "yarn expo install";

function runPreinstall() {
  const { list, source } = loadRules();
  maybeLogSource(list, source);

  let pkg;
  try {
    // Read the package being installed via cwd (yarn runs preinstall from the package root), NOT __dirname: cmd-guard.js may be a symlink (mono/mobile -> expo), and __dirname would resolve to the expo source and validate the wrong package.json.
    pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  } catch (e) {
    process.exit(0);
  }

  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  const hits = [];
  for (const dep of deps) {
    const hit = firstMatch(list, `${INSTALL_FORM} ${dep}`);
    if (hit && !hit.entry.allowed) hits.push({ dep, entry: hit.entry });
  }
  if (hits.length === 0) process.exit(0);

  console.error("");
  console.error("Disallowed packages found in package.json:");
  for (const h of hits) {
    console.error(`  ${h.dep}${h.entry.reason ? " - " + h.entry.reason : ""}${h.entry.alternate ? " (use: " + h.entry.alternate + ")" : ""}`);
  }
  console.error("");
  console.error("  Recovery: run `git checkout package.json` to undo the add.");
  console.error("");
  process.exit(1);
}

function runListCommands() {
  const { list } = loadRules();
  for (const name of listBinaries(list)) console.log(name);
  process.exit(0);
}

module.exports = { runArgs, runPreinstall, runListCommands };
