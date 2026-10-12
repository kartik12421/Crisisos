// Pattern matching, backed by the vendored wildcard-match package with separator " ":
// patterns are command-line globs — "*" = one word, "**" = any words (incl. none).
// e.g. "yarn add **", "yarn expo install ** expo-av* **", "eas **".

const wcmatch = require("./vendor/wildcard-match");

const cache = new Map();

function compile(pattern) {
  let isMatch = cache.get(pattern);
  if (!isMatch) {
    isMatch = wcmatch(pattern.trim(), { separator: " " });
    cache.set(pattern, isMatch);
  }
  return isMatch;
}

// First entry in declaration order whose pattern matches wins.
function firstMatch(list, subject) {
  for (const [pattern, entry] of Object.entries(list)) {
    if (compile(pattern)(subject)) return { pattern, entry };
  }
  return null;
}

// Guarded binaries = unique first word of each pattern (drives sync-shims.sh).
function listBinaries(list) {
  const names = new Set();
  for (const pattern of Object.keys(list)) {
    const first = pattern.trim().split(/\s+/)[0];
    if (first && !first.includes("*")) names.add(first);
  }
  return [...names];
}

module.exports = { compile, firstMatch, listBinaries };
