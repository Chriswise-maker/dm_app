import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './drizzle/schema';
import 'dotenv/config';

const run = async () => {
    if (!process.env.DATABASE_URL) {
        console.error('DATABASE_URL is not set');
        process.exit(1);
    }

    const client = postgres(process.env.DATABASE_URL);
    const db = drizzle(client, { schema });

    try {
        console.log('--- USERS ---');
        const users = await db.query.users.findMany();
        console.log(JSON.stringify(users, null, 2));

        console.log('\n--- USER SETTINGS ---');
        const settings = await db.query.userSettings.findMany();
        console.log(JSON.stringify(settings, null, 2));

    } catch (error) {
        console.error('Error querying DB:', error);
    }

    await client.end();
};

run();
