#!/usr/bin/env bash
set -euo pipefail

# ── Orchestrator ──────────────────────────────────────────────────────────────
# Reads numbered steps from a task file, feeds each to Claude Code CLI,
# runs verification gates, handles rate limits, and logs everything.
#
# Usage:
#   ./scripts/orchestrate.sh                        # uses scripts/TASKS.md
#   ./scripts/orchestrate.sh scripts/my-tasks.md    # custom task file
#   ./scripts/orchestrate.sh --dry-run              # parse & print steps only
#   ./scripts/orchestrate.sh --start-at 3           # resume from step 3
#   ./scripts/orchestrate.sh --skip-verify          # skip verification gates
# ──────────────────────────────────────────────────────────────────────────────

TASK_FILE="${1:-scripts/TASKS.md}"
DRY_RUN=false
START_AT=1
SKIP_VERIFY=false
LOG_DIR="scripts/logs"
RATE_LIMIT_WAIT=1800      # 30 minutes between retries (plan rate limits)
RATE_LIMIT_MAX_RETRIES=8  # 8 retries × 30 min = 4 hours max wait
MAX_BUDGET_PER_STEP=5     # max USD spend per step (safety net)
MAX_FIX_ATTEMPTS=3        # max times Claude can try to fix a failing step

# ── Parse flags ───────────────────────────────────────────────────────────────
args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)    DRY_RUN=true; shift ;;
    --skip-verify) SKIP_VERIFY=true; shift ;;
    --start-at)   START_AT="$2"; shift 2 ;;
    -*)           echo "Unknown flag: $1"; exit 1 ;;
    *)            args+=("$1"); shift ;;
  esac
done
if [[ ${#args[@]} -gt 0 ]]; then
  TASK_FILE="${args[0]}"
fi

if [[ ! -f "$TASK_FILE" ]]; then
  echo "Error: Task file not found: $TASK_FILE"
  echo "Create one using scripts/TASKS.example.md as a template."
  exit 1
fi

# ── Setup logging ─────────────────────────────────────────────────────────────
mkdir -p "$LOG_DIR"
RUN_ID=$(date +%Y%m%d_%H%M%S)
RUN_LOG="$LOG_DIR/run_${RUN_ID}.log"

log() {
  local msg="[$(date '+%H:%M:%S')] $*"
  echo "$msg"
  echo "$msg" >> "$RUN_LOG"
}

log_separator() {
  local sep="────────────────────────────────────────────────────"
  echo "$sep"
  echo "$sep" >> "$RUN_LOG"
}

# ── Parse task file ───────────────────────────────────────────────────────────
# Format: ## N. Title\n<body until next ## or EOF>
# Lines starting with <!-- are comments and skipped.
declare -a STEP_NUMS=()
declare -a STEP_TITLES=()
declare -a STEP_BODIES=()

current_num=""
current_title=""
current_body=""

flush_step() {
  if [[ -n "$current_num" ]]; then
    STEP_NUMS+=("$current_num")
    STEP_TITLES+=("$current_title")
    # Trim leading/trailing whitespace from body
    current_body="$(echo "$current_body" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    STEP_BODIES+=("$current_body")
  fi
}

while IFS= read -r line || [[ -n "$line" ]]; do
  # Match step headers: ## 1. Title  or  ## 12. Title
  if [[ "$line" =~ ^##[[:space:]]+([0-9]+)\.[[:space:]]+(.*) ]]; then
    flush_step
    current_num="${BASH_REMATCH[1]}"
    current_title="${BASH_REMATCH[2]}"
    current_body=""
  elif [[ -n "$current_num" ]]; then
    # Skip HTML comments
    [[ "$line" =~ ^[[:space:]]*\<!-- ]] && continue
    current_body+="$line"$'\n'
  fi
done < "$TASK_FILE"
flush_step

TOTAL_STEPS=${#STEP_NUMS[@]}

if [[ $TOTAL_STEPS -eq 0 ]]; then
  echo "Error: No steps found in $TASK_FILE"
  echo "Steps must be formatted as: ## N. Title"
  exit 1
fi

log "Orchestrator started — $TOTAL_STEPS steps from $TASK_FILE"
log "Run log: $RUN_LOG"
log_separator

# ── Dry run ───────────────────────────────────────────────────────────────────
if $DRY_RUN; then
  echo ""
  echo "Parsed $TOTAL_STEPS steps (dry run — nothing will be executed):"
  echo ""
  for i in "${!STEP_NUMS[@]}"; do
    echo "  Step ${STEP_NUMS[$i]}: ${STEP_TITLES[$i]}"
    # Show first 2 lines of body as preview
    echo "${STEP_BODIES[$i]}" | head -2 | sed 's/^/    /'
    echo ""
  done
  exit 0
fi

# ── Verification gate ────────────────────────────────────────────────────────
verify() {
  local step_num="$1"

  if $SKIP_VERIFY; then
    log "  [verify] Skipped (--skip-verify)"
    return 0
  fi

  log "  [verify] Running: pnpm check && pnpm test"

  local verify_log="$LOG_DIR/verify_step${step_num}_${RUN_ID}.log"

  if ! pnpm check >> "$verify_log" 2>&1; then
    log "  [verify] FAILED (typecheck) — see $verify_log"
    return 1
  fi

  if ! pnpm test >> "$verify_log" 2>&1; then
    log "  [verify] FAILED (tests) — see $verify_log"
    return 1
  fi

  log "  [verify] pnpm check + pnpm test PASSED"

  # ── Chat scenario (optional) ─────────────────────────────────────────────
  # If scripts/scenarios/step-N.json exists, run it against the live server.
  # The dev server must already be running (pnpm dev in another terminal).
  local scenario="scripts/scenarios/step-${step_num}.json"
  if [[ -f "$scenario" ]]; then
    log "  [chat-verify] Running scenario: $scenario"
    local chat_log="$LOG_DIR/chat_step${step_num}_${RUN_ID}.log"
    if BASE_URL="${BASE_URL:-http://localhost:3000}" npx tsx scripts/chat-test.ts --scenario "$scenario" >> "$chat_log" 2>&1; then
      log "  [chat-verify] PASSED"
    else
      log "  [chat-verify] FAILED — see $chat_log"
      return 1
    fi
  fi

  return 0
}

# ── Git checkpoint ────────────────────────────────────────────────────────────
checkpoint() {
  local step_num="$1"
  local title="$2"
  if git diff-index --quiet HEAD -- 2>/dev/null; then
    log "  [git] No changes to commit"
    return 0
  fi
  git add -A
  git commit -m "orchestrator: step ${step_num} — ${title}" --no-verify >/dev/null 2>&1
  log "  [git] Committed: step ${step_num} — ${title}"
}

# ── Invoke Claude Code ────────────────────────────────────────────────────────
invoke_claude() {
  local step_num="$1"
  local prompt="$2"
  local output_file="$LOG_DIR/claude_step${step_num}_${RUN_ID}.md"
  local retries=0

  while true; do
    log "  [claude] Sending to Claude Code CLI..."

    local exit_code=0
    # Use claude with --print for non-interactive mode
    # Scoped permissions: file tools + only the bash commands the agent needs
    # File tools (Read/Edit/Write/Glob/Grep) are scoped to cwd by default
    claude -p "$prompt" --print \
      --model opus \
      --permission-mode bypassPermissions \
      --allowedTools "Read" "Edit" "Write" "Glob" "Grep" \
        "Bash(pnpm check*)" "Bash(pnpm test*)" "Bash(pnpm db:push*)" "Bash(pnpm format*)" \
        "Bash(npx tsx *)" "Bash(mkdir *)" "Bash(git clone *)" "Bash(git diff*)" "Bash(git status*)" \
        "Bash(curl *)" "Bash(ls *)" "Bash(cat *)" "Bash(chmod *)" \
      --max-budget-usd "$MAX_BUDGET_PER_STEP" \
      > "$output_file" 2>&1 || exit_code=$?

    # Check for rate limiting (exit code 2 or specific error text)
    if [[ $exit_code -ne 0 ]] && grep -qi "rate.limit\|429\|quota\|too many requests" "$output_file" 2>/dev/null; then
      retries=$((retries + 1))
      if [[ $retries -ge $RATE_LIMIT_MAX_RETRIES ]]; then
        log "  [claude] Rate limited $retries times — giving up on this step"
        return 1
      fi
      log "  [claude] Rate limited — sleeping ${RATE_LIMIT_WAIT}s (retry $retries/$RATE_LIMIT_MAX_RETRIES)"
      sleep "$RATE_LIMIT_WAIT"
      continue
    fi

    if [[ $exit_code -ne 0 ]]; then
      log "  [claude] Failed with exit code $exit_code — see $output_file"
      return 1
    fi

    log "  [claude] Done — output saved to $output_file"
    return 0
  done
}

# ── Main loop ─────────────────────────────────────────────────────────────────
passed=0
failed=0

for i in "${!STEP_NUMS[@]}"; do
  num="${STEP_NUMS[$i]}"
  title="${STEP_TITLES[$i]}"
  body="${STEP_BODIES[$i]}"

  if [[ "$num" -lt "$START_AT" ]]; then
    log "Step $num: $title — SKIPPED (--start-at $START_AT)"
    continue
  fi

  log_separator
  log "Step $num/$TOTAL_STEPS: $title"

  # Build the prompt: include project context + step instructions
  prompt="You are working on the D&D DM App project. Complete this task:

## Step $num: $title

$body

Important:
- Make the minimal changes needed to complete this step.
- Do not refactor unrelated code.
- Run tests if you change test-adjacent code.
- If something is unclear, implement the most straightforward interpretation."

  if ! invoke_claude "$num" "$prompt"; then
    log "Step $num: FAILED (Claude invocation error)"
    failed=$((failed + 1))
    log ""
    log "STOPPED — Step $num failed. Fix manually and re-run with --start-at $num"
    break
  fi

  # ── Verify + auto-fix loop ──────────────────────────────────────────────
  step_passed=false
  fix_attempt=0

  while [[ $fix_attempt -le $MAX_FIX_ATTEMPTS ]]; do
    if verify "$num"; then
      step_passed=true
      break
    fi

    fix_attempt=$((fix_attempt + 1))
    if [[ $fix_attempt -gt $MAX_FIX_ATTEMPTS ]]; then
      log "Step $num: FAILED after $MAX_FIX_ATTEMPTS fix attempts"
      break
    fi

    log "  [fix] Attempt $fix_attempt/$MAX_FIX_ATTEMPTS — sending errors back to Claude"

    # Read the verification log to get the actual errors
    verify_log="$LOG_DIR/verify_step${num}_${RUN_ID}.log"
    errors=""
    if [[ -f "$verify_log" ]]; then
      errors=$(tail -50 "$verify_log")
    fi

    # Also read chat verification log if it exists
    chat_log="$LOG_DIR/chat_step${num}_${RUN_ID}.log"
    if [[ -f "$chat_log" ]]; then
      errors="$errors
--- Chat scenario output ---
$(cat "$chat_log")"
    fi

    # Build a fix prompt with the original task + error output
    fix_prompt="You are working on the D&D DM App project. You just attempted Step $num but verification failed.

## Original task: $title

$body

## Verification errors:

\`\`\`
$errors
\`\`\`

Fix these errors. The original task instructions above still apply.
Run \`pnpm check\` and \`pnpm test\` after your fixes to verify they work."

    fix_output="$LOG_DIR/claude_step${num}_fix${fix_attempt}_${RUN_ID}.md"
    fix_exit=0
    log "  [fix] Sending fix prompt to Claude..."
    claude -p "$fix_prompt" --print \
      --allowedTools "Read" "Edit" "Write" "Glob" "Grep" \
        "Bash(pnpm check*)" "Bash(pnpm test*)" "Bash(pnpm db:push*)" "Bash(pnpm format*)" \
        "Bash(npx tsx *)" "Bash(mkdir *)" "Bash(git clone *)" "Bash(git diff*)" "Bash(git status*)" \
        "Bash(curl *)" "Bash(ls *)" "Bash(cat *)" "Bash(chmod *)" \
      --max-budget-usd "$MAX_BUDGET_PER_STEP" \
      > "$fix_output" 2>&1 || fix_exit=$?

    if [[ $fix_exit -ne 0 ]] && grep -qi "rate.limit\|429\|quota\|too many requests" "$fix_output" 2>/dev/null; then
      log "  [fix] Rate limited — sleeping ${RATE_LIMIT_WAIT}s"
      sleep "$RATE_LIMIT_WAIT"
      fix_attempt=$((fix_attempt - 1))  # don't count rate limit as a fix attempt
      continue
    fi

    if [[ $fix_exit -ne 0 ]]; then
      log "  [fix] Claude fix attempt failed (exit $fix_exit) — see $fix_output"
    else
      log "  [fix] Claude fix attempt done — re-verifying..."
    fi
  done

  if ! $step_passed; then
    failed=$((failed + 1))
    log ""
    log "STOPPED — Step $num failed verification after $MAX_FIX_ATTEMPTS fix attempts."
    log "  Review: $LOG_DIR/verify_step${num}_${RUN_ID}.log"
    log "  Fix manually, then re-run with: ./scripts/orchestrate.sh --start-at $num"
    break
  fi

  checkpoint "$num" "$title"
  passed=$((passed + 1))
  log "Step $num: PASSED"
done

# ── Summary ───────────────────────────────────────────────────────────────────
log_separator
log "Run complete: $passed passed, $failed failed, $TOTAL_STEPS total"
log "Full log: $RUN_LOG"

if [[ $failed -gt 0 ]]; then
  exit 1
fi
