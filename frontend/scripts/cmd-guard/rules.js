
const fs = require("fs");
const crypto = require("crypto");

const RULES_PATH = process.env.CMD_GUARD_RULES || "/opt/install-guard/rules.json";

const DEFAULT_LIST = {
  "yarn add ** expo-av* **": { allowed: false, reason: "expo-av is deprecated", alternate: "expo-audio / expo-video" },
  "yarn expo install ** expo-av* **": { allowed: false, reason: "expo-av is deprecated", alternate: "expo-audio / expo-video" },
  "yarn add ** expo-barcode-scanner* **": { allowed: false, reason: "deprecated", alternate: "expo-camera" },
  "yarn expo install ** expo-barcode-scanner* **": { allowed: false, reason: "deprecated", alternate: "expo-camera" },
  "yarn add ** expo-background-fetch* **": { allowed: false, reason: "deprecated", alternate: "expo-background-task" },
  "yarn expo install ** expo-background-fetch* **": { allowed: false, reason: "deprecated", alternate: "expo-background-task" },
  "yarn add ** expo-file-system/legacy* **": { allowed: false, reason: "deprecated", alternate: "expo-file-system" },
  "yarn expo install ** expo-file-system/legacy* **": { allowed: false, reason: "deprecated", alternate: "expo-file-system" },
};

function isFlatList(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const values = Object.values(parsed);
  return values.length > 0 && values.every((v) => v && typeof v === "object" && typeof v.allowed === "boolean");
}

function loadRules() {
  // Fail-closed: a MISSING file means no injection (baked default); a present-but-unreadable/malformed/invalid file rejects rather than silently dropping injected-only prohibitions.
  let raw;
  try {
    raw = fs.readFileSync(RULES_PATH, "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") return { list: DEFAULT_LIST, source: "baked" };
    throw new Error(`cmd-guard: injected rules at ${RULES_PATH} are unreadable (${(e && e.code) || e}); refusing to fall back to baked rules`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`cmd-guard: injected rules at ${RULES_PATH} are not valid JSON; refusing to fall back to baked rules`);
  }
  if (!isFlatList(parsed)) {
    throw new Error(`cmd-guard: injected rules at ${RULES_PATH} are not a valid rule list; refusing to fall back to baked rules`);
  }
  return { list: parsed, source: "injected" };
}

// CMD_GUARD_DEBUG=1 prints which ruleset is active (injected vs baked) + a content hash.
function maybeLogSource(list, source) {
  if (!process.env.CMD_GUARD_DEBUG) return;
  const sha = crypto.createHash("sha256").update(JSON.stringify(list)).digest("hex").slice(0, 8);
  console.error(`cmd-guard: rules source=${source} sha=${sha}`);
}

module.exports = { loadRules, maybeLogSource };
