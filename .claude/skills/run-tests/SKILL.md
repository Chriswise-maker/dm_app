---
name: run-tests
description: Run tests related to recent changes or a specific area (combat, kernel, srd, skill-check, rest, etc.)
---

# Run Tests

Run the tests most relevant to what was just changed.

## Steps

1. If the user specified an area (e.g. "combat", "kernel", "srd"), run tests for that area:
   - `pnpm test -- server/combat/` for combat
   - `pnpm test -- server/kernel/` for kernel
   - `pnpm test -- server/srd/` for SRD
   - `pnpm test -- server/<file>.test.ts` for specific files like skill-check, rest, shopping, travel, social-encounter

2. If no area specified, check which files were recently modified:
   - Run `git diff --name-only HEAD` to find changed files
   - Match changed files to their test files and run those
   - If no specific match, run the full suite: `pnpm test`

3. Report results concisely:
   - Number of tests passed/failed
   - For failures: show the test name and a one-line summary of what went wrong
   - Don't dump full stack traces unless asked
