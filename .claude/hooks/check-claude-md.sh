#!/bin/bash

# PostToolUse hook: reminds to update CLAUDE.md when architectural files change.
# Reads JSON from stdin with tool_input.file_path.

HOOK_INPUT=$(cat)
FILE_PATH=$(echo "$HOOK_INPUT" | jq -r '.tool_input.file_path // empty')

# No file path means not a file edit — skip
[ -z "$FILE_PATH" ] && exit 0

# Don't trigger on CLAUDE.md edits themselves
[[ "$FILE_PATH" == */CLAUDE.md ]] && exit 0

# Architectural files that should trigger a CLAUDE.md review
ARCH_PATTERNS=(
  "server/routers\.ts"
  "server/_core/index\.ts"
  "server/_core/trpc\.ts"
  "server/_core/context\.ts"
  "server/_core/llm-with-settings\.ts"
  "server/db\.ts"
  "server/message-send\.ts"
  "server/prompts\.ts"
  "server/combat/combat-types\.ts"
  "server/combat/combat-engine-v2\.ts"
  "server/combat/combat-engine-manager\.ts"
  "server/combat/enemy-ai-controller\.ts"
  "drizzle/schema\.ts"
  "client/src/main\.tsx"
  "client/src/App\.tsx"
  "client/src/lib/trpc\.ts"
  "package\.json"
  "tsconfig\.json"
  "vite\.config\.ts"
)

MATCHED=false
for pattern in "${ARCH_PATTERNS[@]}"; do
  if echo "$FILE_PATH" | grep -qE "$pattern"; then
    MATCHED=true
    break
  fi
done

# Also trigger if a new file is created in server/combat/
if [ "$MATCHED" = false ]; then
  TOOL_NAME=$(echo "$HOOK_INPUT" | jq -r '.tool_name // empty')
  if [ "$TOOL_NAME" = "Write" ] && echo "$FILE_PATH" | grep -qE "server/combat/[^/]+\.(ts|tsx)$"; then
    MATCHED=true
  fi
fi

[ "$MATCHED" = false ] && exit 0

# Determine which CLAUDE.md is relevant
RELEVANT_CLAUDE_MD="dm_app/CLAUDE.md"
if echo "$FILE_PATH" | grep -qE "server/combat/"; then
  RELEVANT_CLAUDE_MD="dm_app/server/combat/CLAUDE.md AND dm_app/CLAUDE.md"
fi

cat <<EOF
CLAUDE.md Review Needed: You just modified an architectural file ($(basename "$FILE_PATH")). Check if $RELEVANT_CLAUDE_MD needs updating to reflect this change.
EOF

exit 0
