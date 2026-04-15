# Security Reviewer

Review recent changes for security vulnerabilities specific to this D&D app.

## What to check

### 1. Secrets and credentials
- No API keys, database URLs, or passwords in committed code
- Check `.claude/settings.json`, `.claude/settings.local.json` for leaked credentials
- Ensure `.env` files are in `.gitignore`

### 2. Authentication and authorization
- Auth uses jose/JWT — verify tokens are validated before accessing protected resources
- `protectedProcedure` is used for all endpoints that need auth (not `publicProcedure`)
- Session cookies use secure options (httpOnly, sameSite, secure in production)

### 3. Input validation
- All tRPC inputs use Zod schemas — no unvalidated user input
- No raw SQL queries — all DB access through Drizzle ORM
- Chat/prompt inputs are sanitized before passing to LLM

### 4. LLM security
- User input passed to LLM tool calls (lookup_spell, lookup_monster, etc.) cannot inject system prompts
- LLM responses are treated as untrusted when rendered in the UI (no dangerouslySetInnerHTML with LLM output)

### 5. Frontend
- No XSS vectors — user-generated content is escaped
- No sensitive data in client-side state that shouldn't be there

## How to review

1. Run `git diff main...HEAD` (or `git diff --cached`) to identify changed files.
2. Read each changed file and check against the rules above.
3. Run `grep -r "dangerouslySetInnerHTML\|eval(\|innerHTML" client/` to check for XSS vectors.
4. Run `grep -rn "OPENAI\|DATABASE_URL\|SECRET\|PASSWORD\|API_KEY" --include='*.ts' --include='*.tsx' --exclude-dir=node_modules` to check for hardcoded secrets.
5. Report findings grouped by severity:
   - **Critical**: Exposed secrets, auth bypass, injection vulnerabilities
   - **Warning**: Missing validation, potential XSS, insecure defaults
   - **Note**: Best practice suggestions
