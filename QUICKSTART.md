# Quick Start Guide - D&D Dungeon Master Chat

Get up and running in 5 minutes!

## Step 1: Extract the Archive

```bash
tar -xzf dm-app-standalone.tar.gz
cd dm-app
```

## Step 2: Install Dependencies

```bash
# Install pnpm if you don't have it
npm install -g pnpm

# Install project dependencies
pnpm install
```

## Step 3: Set Up Environment

```bash
# Copy the example environment file
cp .env.example.standalone .env

# Edit .env with your favorite editor
nano .env  # or vim, code, cursor, etc.
```

**Required values to change:**
- `DATABASE_URL` - Your MySQL connection string
- `JWT_SECRET` - Generate with: `openssl rand -base64 32`
- At least one API key: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GOOGLE_API_KEY`

## Step 4: Set Up Database

### Option A: Use PlanetScale (Easiest - Free Tier)

1. Go to https://planetscale.com/
2. Sign up and create a new database
3. Copy the connection string
4. Paste it into your `.env` as `DATABASE_URL`

### Option B: Local MySQL

```bash
# Install MySQL
# macOS: brew install mysql
# Ubuntu: sudo apt install mysql-server

# Start MySQL
# macOS: brew services start mysql
# Ubuntu: sudo systemctl start mysql

# Create database
mysql -u root -p
CREATE DATABASE dnd_dm_chat;
exit;

# Update .env with:
DATABASE_URL=mysql://root:your_password@localhost:3306/dnd_dm_chat
```

## Step 5: Initialize Database

```bash
pnpm db:push
```

## Step 6: Start the App

```bash
pnpm dev
```

Open http://localhost:3000 in your browser!

## Troubleshooting

### "Cannot connect to database"
- Check your `DATABASE_URL` is correct
- Ensure MySQL is running
- Verify the database exists

### "API key not configured"
- Check your `.env` file has at least one API key
- Restart the dev server after editing `.env`

### "Port 3000 already in use"
- Change `PORT=3001` in `.env`
- Or kill the process: `lsof -ti:3000 | xargs kill -9`

## Opening in Cursor/VS Code

```bash
# Open the project
cursor .
# or
code .
```

## Next Steps

1. **Create a Campaign** - Click the "+" button next to Campaigns
2. **Create a Character** - Select your campaign, then click "+" next to Characters
3. **Start Playing** - Select your character and start chatting with the AI DM!

## Customization

- **Change DM Personality**: Settings → DM Personality tab
- **Switch LLM Provider**: Settings → LLM Configuration tab
- **Modify Database Schema**: Edit `drizzle/schema.ts` then run `pnpm db:push`

For detailed information, see `STANDALONE_SETUP.md`

Happy adventuring! 🎲✨
