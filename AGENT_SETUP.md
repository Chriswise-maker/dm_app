# AI Agent Setup Guide - D&D Dungeon Master App

> **Purpose**: Step-by-step instructions for AI coding agents to set up this project from a fresh clone.

## Prerequisites

The user's machine must have:
- **Node.js** v20+ 
- **pnpm** (install with `npm install -g pnpm` if missing)
- **Git**

## Step 1: Clone the Repository

```bash
git clone https://github.com/Chriswise-maker/dm_app.git
cd dm_app
```

## Step 2: Install Dependencies

```bash
pnpm install
```

This will install all packages defined in `package.json` and apply the patch in `patches/wouter@3.7.1.patch`.

## Step 3: Create Environment File

Create a `.env` file in the project root with the following structure:

```bash
# Database (REQUIRED)
DATABASE_URL="postgresql://user:password@host:5432/database?sslmode=require"

# JWT Secret (REQUIRED) - Generate with: openssl rand -base64 32
JWT_SECRET=your-generated-secret-here

# LLM API Keys (at least ONE is required)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=AI...

# App Configuration (optional, has defaults)
VITE_APP_TITLE=D&D Dungeon Master Chat
PORT=3000

# OAuth (Optional - for multi-user support)
# If omitted, app runs in single-user mode
OAUTH_SERVER_URL=http://localhost:3000
VITE_OAUTH_PORTAL_URL=http://localhost:3000
OWNER_OPEN_ID=local-user
OWNER_NAME=Local User
```

### Required Environment Variables

| Variable | Description | How to Get |
|----------|-------------|------------|
| `DATABASE_URL` | PostgreSQL connection string | Use [Neon](https://neon.tech) (free) or local PostgreSQL |
| `JWT_SECRET` | Auth token signing key | Run `openssl rand -base64 32` |
| `OPENAI_API_KEY` | OpenAI API key | [platform.openai.com](https://platform.openai.com) |
| `ANTHROPIC_API_KEY` | Anthropic API key | [console.anthropic.com](https://console.anthropic.com) |
| `GOOGLE_API_KEY` | Google Gemini API key | [makersuite.google.com](https://makersuite.google.com) |

> **Note**: You need at least one LLM API key. Google Gemini has a free tier.

## Step 4: Initialize Database

Run the database migrations to create all required tables:

```bash
pnpm db:push
```

This uses Drizzle ORM to generate and apply migrations from `drizzle/schema.ts`.

## Step 5: Start Development Server

```bash
pnpm dev
```

The app will be available at **http://localhost:3000**.

---

## Project Structure

```
dm_app/
├── client/                 # React frontend (Vite)
│   ├── src/
│   │   ├── components/     # UI components
│   │   ├── hooks/          # React hooks
│   │   └── pages/          # Page components
├── server/                 # Express + tRPC backend
│   ├── _core/              # Server setup (index.ts entry point)
│   ├── combat/             # Combat Engine V2
│   │   ├── combat-engine-v2.ts    # Core deterministic engine
│   │   ├── combat-types.ts        # Zod schemas
│   │   ├── enemy-ai-controller.ts # LLM-driven enemy turns
│   │   └── player-action-parser.ts # Parse player chat actions
│   ├── routers.ts          # tRPC API endpoints
│   ├── db.ts               # Database functions
│   └── prompts.ts          # LLM prompt templates
├── drizzle/                # Database schema & migrations
│   └── schema.ts           # Table definitions
├── docs/combat/            # Combat engine documentation
└── .agent/workflows/       # Agent workflows
```

## Key npm Scripts

| Script | Purpose |
|--------|---------|
| `pnpm dev` | Start development server on port 3000 |
| `pnpm build` | Build for production |
| `pnpm test` | Run Vitest tests |
| `pnpm db:push` | Generate and apply database migrations |
| `pnpm check` | TypeScript type checking |

## Running Tests

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test -- server/combat/__tests__/combat-engine-v2.test.ts
```

## Common Issues

### Port 3000 already in use
```bash
# Kill existing process
pnpm clean
# Or manually
lsof -ti:3000 | xargs kill -9
```

### Database connection failed
- Verify `DATABASE_URL` is correct
- Check the database server is running
- For Neon: ensure `?sslmode=require` is in the URL

### "No LLM provider configured"
- Ensure at least one of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GOOGLE_API_KEY` is set
- Restart dev server after editing `.env`

### TypeScript errors on import
```bash
# Ensure all dependencies are installed
pnpm install

# Check for type errors
pnpm check
```

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, Vite, TailwindCSS, Radix UI |
| Backend | Express, tRPC, Zod |
| Database | PostgreSQL, Drizzle ORM |
| LLM | OpenAI, Anthropic, Google Gemini |
| Testing | Vitest |

## Workflow for Combat Engine Changes

Use the `/combat` workflow for combat-related development:
```bash
# Read the workflow instructions first
cat .agent/workflows/combat.md
```

---

## Quick Verification Checklist

After setup, verify everything works:

1. [ ] `pnpm install` completed without errors
2. [ ] `.env` file exists with `DATABASE_URL`, `JWT_SECRET`, and at least one LLM key
3. [ ] `pnpm db:push` ran successfully
4. [ ] `pnpm dev` starts server at http://localhost:3000
5. [ ] `pnpm test` passes (14 combat engine tests)
6. [ ] Browser shows the app at localhost:3000

If all checks pass, the setup is complete! 🎉
