import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../drizzle/schema';
import 'dotenv/config';

const run = async () => {
    const client = postgres(process.env.DATABASE_URL!);
    const db = drizzle(client, { schema });

    try {
        // Check if column exists by trying to select it
        const result = await client`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'userSettings' 
      AND column_name = 'campaignGenerationPrompt';
    `;

        if (result.length > 0) {
            console.log('✅ Column campaignGenerationPrompt exists!');
        } else {
            console.error('❌ Column campaignGenerationPrompt does NOT exist.');
            // Try to add it manually if missing
            console.log('Attempting to add column manually...');
            await client`ALTER TABLE "userSettings" ADD COLUMN "campaignGenerationPrompt" text;`;
            console.log('✅ Column added manually.');
        }
    } catch (error) {
        console.error('Error checking DB:', error);
    }

    process.exit(0);
};

run();
