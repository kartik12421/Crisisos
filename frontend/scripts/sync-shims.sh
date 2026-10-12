#!/usr/bin/env bash
# Generate command-guard shims from the ACTIVE ruleset (injected rules.json or the baked default); transactional and fail-closed so a guard failure never strips the live shim set.
set -e

SCRIPT_DIR=$(dirname "$(readlink -f "$0")")
GUARD="$SCRIPT_DIR/cmd-guard.js"
SHIM_SRC="$SCRIPT_DIR/install-guard.sh"
BIN_DIR=${INSTALL_GUARD_BIN:-/opt/install-guard/bin}
MASTER="$BIN_DIR/.install-guard.sh"

[ -f "$GUARD" ] || { echo "sync-shims: cmd-guard.js not found at $GUARD; refusing to sync" >&2; exit 1; }

# Capture the list in its own statement so a node crash/non-zero is observable (set -e cannot see a failure inside a for-word-list).
if ! CMD_LIST=$(node "$GUARD" --list-commands); then
  echo "sync-shims: 'node cmd-guard.js --list-commands' failed; refusing to drop shims" >&2; exit 1
fi
# shellcheck disable=SC2206
CMDS=($CMD_LIST)
[ "${#CMDS[@]}" -gt 0 ] || { echo "sync-shims: empty command list; refusing to drop shims" >&2; exit 1; }

mkdir -p "$BIN_DIR"
install -m 0755 "$SHIM_SRC" "$MASTER"

# Absolute path to the resolved cmd-guard.js, written next to the bin dir and consumed by each shim's <SELF_DIR>/../.guard-path read.
GUARD_PATH_DIR=$(dirname "$BIN_DIR"); mkdir -p "$GUARD_PATH_DIR"
printf '%s' "$GUARD" > "$GUARD_PATH_DIR/.guard-path"

# Refresh shims in place (ln -sf is atomic per name, never a delete-then-recreate gap).
for name in "${CMDS[@]}"; do ln -sf "$MASTER" "$BIN_DIR/$name"; done

# Prune stale shims LAST: only our symlinks no longer in the validated set, so a removed command stops being guarded without ever leaving the live set short.
for f in "$BIN_DIR"/*; do
  [ -L "$f" ] && [ "$(readlink "$f")" = "$MASTER" ] || continue
  case " ${CMDS[*]} " in *" $(basename "$f") "*) : ;; *) rm -f "$f" ;; esac
done
