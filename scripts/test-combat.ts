/**
 * Interactive Combat Engine Demo
 * 
 * Run with: npx tsx scripts/test-combat.ts
 */

import { createCombatEngine } from "../server/combat/combat-engine-v2";
import { createPlayerEntity, createEnemyEntity } from "../server/combat/combat-types";

// Create a combat engine
const engine = createCombatEngine(1);

// Create combatants
const player = createPlayerEntity(
    "hero-1",
    "Aragorn",
    30,   // hp
    30,   // maxHp
    16,   // ac
    15,   // initiative (already rolled)
    {
        attackModifier: 5,
        damageFormula: "1d8+3",
        initiativeModifier: 2,
    }
);

const goblin1 = createEnemyEntity(
    "goblin-1",
    "Sneaky Goblin",
    7,    // hp
    12,   // ac
    4,    // attackMod
    "1d6+2",
    { initiativeModifier: 2 }
);

const goblin2 = createEnemyEntity(
    "goblin-2",
    "Angry Goblin",
    7,
    12,
    4,
    "1d6+2",
    { initiativeModifier: 2 }
);

console.log("=".repeat(60));
console.log("COMBAT ENGINE V2 - INTERACTIVE DEMO");
console.log("=".repeat(60));
console.log();

// Start combat
console.log("🗡️  INITIATING COMBAT...\n");
const initLogs = engine.initiateCombat([player, goblin1, goblin2]);

for (const log of initLogs) {
    console.log(`  ${log.description}`);
}
console.log();

// Show turn order
const state = engine.getState();
console.log("📋 TURN ORDER:");
for (let i = 0; i < state.turnOrder.length; i++) {
    const entity = engine.getEntity(state.turnOrder[i])!;
    const marker = i === state.turnIndex ? "👉" : "  ";
    console.log(`  ${marker} ${entity.name} (Initiative: ${entity.initiative})`);
}
console.log();

// Simulate a round of combat
console.log("⚔️  ROUND 1 BEGINS\n");

// Get current turn entity
let currentEntity = engine.getCurrentTurnEntity();
console.log(`${currentEntity?.name}'s turn!\n`);

// If it's the player, attack a goblin
if (currentEntity?.type === "player") {
    console.log(`${currentEntity.name} attacks Sneaky Goblin...\n`);

    const attackResult = engine.submitAction({
        type: "ATTACK",
        attackerId: currentEntity.id,
        targetId: "goblin-1",
    });

    for (const log of attackResult.logs) {
        console.log(`  ${log.description}`);
    }
    console.log();
}

// Show HP status
console.log("❤️  HP STATUS:");
for (const entity of engine.getState().entities) {
    const statusIcon = entity.status === "DEAD" ? "💀" : entity.status === "UNCONSCIOUS" ? "😵" : "✅";
    console.log(`  ${statusIcon} ${entity.name}: ${entity.hp}/${entity.maxHp} HP (${entity.status})`);
}
console.log();

// End turn
console.log("➡️  Ending turn...\n");
const endTurnLogs = engine.submitAction({ type: "END_TURN", entityId: currentEntity!.id });
for (const log of endTurnLogs.logs) {
    console.log(`  ${log.description}`);
}
console.log();

// Show next turn
currentEntity = engine.getCurrentTurnEntity();
console.log(`Now it's ${currentEntity?.name}'s turn!`);
console.log();

// Demonstrate undo
console.log("↩️  DEMONSTRATING UNDO...\n");
const goblinHPBefore = engine.getEntity("goblin-1")?.hp;
console.log(`  Goblin HP before undo: ${goblinHPBefore}`);

engine.undoLastAction();
engine.undoLastAction(); // Undo the attack too

const goblinHPAfter = engine.getEntity("goblin-1")?.hp;
console.log(`  Goblin HP after undo: ${goblinHPAfter}`);
console.log();

// Export state
console.log("💾 EXPORTED STATE (first 500 chars):");
const exported = engine.exportState();
console.log(exported.substring(0, 500) + "...");
console.log();

console.log("=".repeat(60));
console.log("DEMO COMPLETE!");
console.log("=".repeat(60));
