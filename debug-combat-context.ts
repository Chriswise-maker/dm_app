import { getDb } from './server/db';
import dotenv from 'dotenv';

dotenv.config();

async function debugCombatContext() {
    console.log('=== DEBUGGING COMBAT CONTEXT ===');
    const db = await getDb();
    if (!db) {
        console.error('Failed to connect to DB');
        return;
    }

    // 1. Get latest session
    const { sessions } = await import('./drizzle/schema');
    const { desc } = await import('drizzle-orm');

    const sessionResults = await db.select().from(sessions).orderBy(desc(sessions.id)).limit(1);

    if (sessionResults.length === 0) {
        console.log('No sessions found.');
        return;
    }

    const sessionId = sessionResults[0].id;
    console.log(`Checking Session ID: ${sessionId}`);

    // 2. Get Combat State
    const combatState = await import('./server/db').then(m => m.getCombatState(sessionId));
    console.log('Combat State:', combatState);

    if (!combatState || combatState.inCombat !== 1) {
        console.log('Session is NOT in combat according to DB.');
    } else {
        console.log('Session IS in combat.');

        // 3. Get Combatants
        const combatants = await import('./server/db').then(m => m.getCombatants(combatState.id));
        console.log(`Found ${combatants.length} combatants:`);
        combatants.forEach(c => {
            console.log(`- [${c.type}] ${c.name} (HP: ${c.hpCurrent}/${c.hpMax}, Init: ${c.initiative})`);
        });

        // 4. Simulate Context Generation (Logic from routers.ts)
        combatants.sort((a, b) => b.initiative - a.initiative);
        const currentCombatant = combatants[combatState.currentTurnIndex];

        const combatContext = `\n[ACTIVE COMBAT - Round ${combatState.currentRound}]
**Current Turn:** ${currentCombatant?.name || 'Unknown'} (Initiative ${currentCombatant?.initiative || 0})

**Initiative Order:**
${combatants.map((c, idx) => {
            const isActive = idx === combatState.currentTurnIndex;
            const status = c.hpCurrent <= 0 ? ' [DEFEATED]' : ` (HP: ${c.hpCurrent}/${c.hpMax}, AC: ${c.ac})`;
            return `${isActive ? '→ ' : '  '}${c.name} [Init: ${c.initiative}]${status}`;
        }).join('\n')}

**Combat Notes:**
- You MUST track HP changes accurately
- When an enemy reaches 0 HP, they are defeated
- Narrate combat actions vividly but keep mechanics deterministic
- Current actor should take their turn
`;

        console.log('\n=== GENERATED PROMPT CONTEXT ===');
        console.log(combatContext);
        console.log('================================');
    }
}

debugCombatContext().catch(console.error).finally(() => process.exit());
