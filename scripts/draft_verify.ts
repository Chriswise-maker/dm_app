
import { handleAutoCombatInitiation } from '../server/combat/combat-helpers';
import { CombatEngineManager } from '../server/combat/combat-engine-manager';
import type { EnemyData } from '../server/response-parser';

// Mock DB modules
const mockCharacter = {
    id: 999,
    name: "Test Hero",
    hpCurrent: 50,
    hpMax: 50,
    ac: 16,
    stats: JSON.stringify({ dex: 14 }), // +2 modifier
};

// Mock the db import
jest.mock('../server/db', () => ({
    getCharacter: jest.fn().mockResolvedValue(mockCharacter),
}));

// Run verification
async function verify() {
    console.log("Starting Verification...");

    // Test Data
    const sessionId = 12345;
    const characterId = 999;
    const enemies: EnemyData[] = [
        {
            name: "Goblin 1",
            ac: 12,
            hpMax: 7,
            attackBonus: 4,
            damageFormula: "1d6+2",
            damageType: "slashing",
            initiative: 10
        },
        {
            name: "Goblin 2",
            ac: 12,
            hpMax: 7,
            attackBonus: 4,
            damageFormula: "1d6+2",
            damageType: "slashing"
            // No initiative, should auto-roll
        }
    ];

    console.log("Calling handleAutoCombatInitiation...");
    const result = await handleAutoCombatInitiation(sessionId, characterId, enemies);

    console.log("Result:", result);

    if (!result.success) {
        console.error("FAILED: handleAutoCombatInitiation returned false");
        process.exit(1);
    }

    // Verify Engine State
    const engine = CombatEngineManager.get(sessionId);
    if (!engine) {
        console.error("FAILED: Engine not created for session", sessionId);
        process.exit(1);
    }

    const state = engine.getState();
    console.log("Engine State:", {
        entityCount: state.entities.length,
        turnOrder: state.turnOrder.length,
        phase: state.phase
    });

    if (state.entities.length !== 3) { // 2 goblins + 1 hero
        console.error(`FAILED: Expected 3 entities, got ${state.entities.length}`);
        process.exit(1);
    }

    const hero = state.entities.find(e => e.type === "player");
    if (!hero) {
        console.error("FAILED: Hero not found in entities");
        process.exit(1);
    }
    console.log("Hero Initiative:", hero.initiative); // Should be rolled (non-zero)

    const goblin1 = state.entities.find(e => e.name === "Goblin 1");
    if (goblin1?.initiative !== 10) {
        console.error(`FAILED: Goblin 1 initiative should be 10, got ${goblin1?.initiative}`);
        process.exit(1);
    }

    console.log("VERIFICATION PASSED!");

    // Clean up
    await CombatEngineManager.destroy(sessionId);
}

// We can't easily use jest.mock in a standalone script run via tsx without setup
// So instead of mocking, I'll create a variant that doesn't rely on jest
// mocking essentially involves writing a script that imports the REAL modules
// but since we don't have a real DB running or we might not want to touch it,
// we have to be careful.

// actually, since I have `sanity.ts` which runs with `tsx`, I can just write a script
// that imports `handleAutoCombatInitiation` and if it fails due to DB connection, 
// I know it tried to connect.
// To properly test logic without DB, I'd need to mock `db.ts` or have a test DB.
// Let's look at `combat-engine-v2.test.ts` to see how they test.
