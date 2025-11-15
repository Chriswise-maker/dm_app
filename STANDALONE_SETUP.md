# D&D Dungeon Master Chat - Standalone Setup Guide

This guide will help you run the D&D Dungeon Master Chat application locally on your machine without any Manus dependencies.

## Prerequisites

- **Node.js** 18+ and **pnpm** installed
- **MySQL** or **TiDB** database (or use a free cloud database like PlanetScale)
- An **OpenAI**, **Anthropic**, or **Google AI** API key

## Quick Start

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Set Up Database

You have several options:

#### Option A: Local MySQL
```bash
# Install MySQL locally
# macOS: brew install mysql
# Ubuntu: sudo apt install mysql-server

# Create database
mysql -u root -p
CREATE DATABASE dnd_dm_chat;
```

#### Option B: Free Cloud Database (Recommended)
- Sign up for [PlanetScale](https://planetscale.com/) (free tier available)
- Create a new database
- Get your connection string

### 3. Configure Environment Variables

Create a `.env` file in the root directory:

```env
# Database
DATABASE_URL=mysql://user:password@localhost:3306/dnd_dm_chat

# JWT Secret (generate a random string)
JWT_SECRET=your-super-secret-jwt-key-change-this

# LLM API Keys (choose one or more)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...

# App Configuration
VITE_APP_TITLE=D&D Dungeon Master Chat
PORT=3000

# OAuth (Optional - for multi-user support)
# If you don't need OAuth, the app will work in single-user mode
OAUTH_SERVER_URL=http://localhost:3000
VITE_OAUTH_PORTAL_URL=http://localhost:3000
OWNER_OPEN_ID=local-user
OWNER_NAME=Local User
```

### 4. Initialize Database Schema

```bash
# Push database schema
pnpm db:push
```

### 5. Start Development Server

```bash
pnpm dev
```

The app will be available at `http://localhost:3000`

## Building for Production

```bash
# Build the application
pnpm build

# Start production server
pnpm start
```

## Project Structure

```
dm-app/
├── client/              # Frontend React application
│   ├── src/
│   │   ├── pages/      # Page components
│   │   ├── components/ # Reusable UI components
│   │   ├── lib/        # tRPC client setup
│   │   └── App.tsx     # Main app component
│   └── index.html
├── server/              # Backend Express + tRPC server
│   ├── _core/          # Core server infrastructure
│   ├── db.ts           # Database queries
│   ├── routers.ts      # tRPC API routes
│   └── context-extraction.ts  # AI context extraction
├── drizzle/            # Database schema
│   └── schema.ts
└── shared/             # Shared types and constants
```

## Configuration

### Using Different LLM Providers

The app supports multiple LLM providers. Configure them in the Settings UI:

1. Open the app
2. Click the Settings icon (⚙️)
3. Go to "LLM Configuration" tab
4. Select your provider and enter API key
5. Choose your preferred model

### Customizing the System Prompt

You can customize the DM's personality and behavior:

1. Go to Settings → "DM Personality" tab
2. Edit the system prompt
3. Click "Save Settings"

### Database Configuration

The app uses Drizzle ORM with MySQL. To modify the schema:

1. Edit `drizzle/schema.ts`
2. Run `pnpm db:push` to apply changes

## Removing Manus Dependencies

This export has removed all Manus-specific code. Key changes:

1. **Authentication**: Simplified to single-user mode (no OAuth required)
2. **LLM Integration**: Direct API calls to OpenAI/Anthropic/Google
3. **Storage**: Removed S3 dependencies (not used in current implementation)
4. **Analytics**: Removed Manus analytics tracking

## Troubleshooting

### Database Connection Issues

If you see database connection errors:

1. Verify your `DATABASE_URL` is correct
2. Ensure your database server is running
3. Check that the database exists
4. Verify user permissions

### LLM API Errors

If you see "API key not configured":

1. Check your `.env` file has the correct API key
2. Restart the dev server after changing `.env`
3. Verify the API key is valid on the provider's website

### Port Already in Use

If port 3000 is already in use:

```bash
# Change port in .env
PORT=3001

# Or kill the process using port 3000
lsof -ti:3000 | xargs kill -9
```

## Development Tips

### Hot Reload

Both frontend and backend support hot reload:
- Frontend: Vite HMR
- Backend: tsx watch mode

### Database Migrations

When you modify the schema:

```bash
# Generate migration
pnpm drizzle-kit generate

# Apply migration
pnpm drizzle-kit migrate
```

### Type Safety

The app uses TypeScript throughout with tRPC for end-to-end type safety. Types are automatically inferred from:
- Database schema → Drizzle types
- tRPC routers → Client types

## IDE Setup (Cursor/VS Code)

### Recommended Extensions

- ESLint
- Prettier
- Tailwind CSS IntelliSense
- TypeScript and JavaScript Language Features

### Opening in Cursor

```bash
# Navigate to project directory
cd dm-app

# Open in Cursor
cursor .
```

### TypeScript Configuration

The project includes `tsconfig.json` for both client and server. TypeScript will automatically provide:
- Auto-completion
- Type checking
- Import suggestions

## Features

- **Campaign Management**: Create and manage multiple D&D campaigns
- **Character Tracking**: HP, stats, inventory, and conditions
- **AI Dungeon Master**: Powered by GPT-4, Claude, or Gemini
- **Context Awareness**: Automatically tracks NPCs, locations, quests
- **Streaming Responses**: Real-time DM responses
- **Smart Auto-Scroll**: Respects user reading position
- **System Prompt Customization**: Customize DM personality
- **Message History**: Full conversation persistence

## License

This project is provided as-is for personal use.

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review the code comments in key files
3. Consult the tRPC and Drizzle documentation

## Next Steps

After getting the app running, consider:

1. **Improve Context Extraction**: Refine prompts in `server/context-extraction.ts`
2. **Add Dice Rolling**: Implement dice roll UI and mechanics
3. **Combat Tracker**: Add initiative tracking and combat mode
4. **Image Generation**: Integrate DALL-E or Stable Diffusion for scene images
5. **Voice Input**: Add speech-to-text for voice commands
6. **Export/Import**: Add campaign export/import functionality

Enjoy your AI-powered D&D adventures! 🎲
