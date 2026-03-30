import { describe, expect, it, vi } from "vitest";
import { createCombatEngine } from "../combat-engine-v2";
import { createEnemyEntity, createPlayerEntity, RangeBand, type CombatEntity } from "../combat-types";

function createPlayer(overrides?: Partial<CombatEntity>) {
    return createPlayerEntity("player-1", "Aragorn", 30, 30, 16, 20, {
        attackModifier: 6,
        damageFormula: "1d8+4",
        abilityScores: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 10 },
        ...overrides,
    });
}

function createGoblin(overrides?: Partial<CombatEntity>) {
    return createEnemyEntity("goblin-1", "Goblin", 24, 12, 4, "1d6+2", {
        initiative: 10,
        ...overrides,
    });
}

describe("Phase A combat mechanics", () => {
    describe("save rolls", () => {
        it("enters AWAIT_SAVE_ROLL when an enemy spell targets a player", () => {
            const engine = createCombatEngine(1);
            const wizard = createEnemyEntity("enemy-1", "Cult Wizard", 20, 12, 4, "1d6", {
                initiative: 20,
                spellSaveDC: 14,
                spellSlots: { "2": 1 },
                spells: [{
                    name: "Hold Person",
                    level: 2,
                    school: "enchantment",
                    castingTime: "action",
                    range: 60,
                    savingThrow: "WIS",
                    halfOnSave: false,
                    requiresConcentration: true,
                    conditions: ["paralyzed"],
                    description: "Paralyze a humanoid.",
                }],
            });
            const player = createPlayer({ initiative: 10, abilityScores: { str: 16, dex: 14, con: 14, int: 10, wis: 8, cha: 10 } });

            engine.prepareCombat([wizard, player]);
            const result = engine.submitAction({
                type: "CAST_SPELL",
                casterId: "enemy-1",
                spellName: "Hold Person",
                targetIds: ["player-1"],
            });

            expect(result.success).toBe(true);
            expect(engine.getState().phase).toBe("AWAIT_SAVE_ROLL");
            expect(engine.getState().pendingSpellSave?.saveStat).toBe("WIS");
            expect(engine.getState().pendingSpellSave?.pendingTargetIds).toEqual(["player-1"]);
        });

        it("applies spell effects after the player submits a failed saving throw", () => {
            const engine = createCombatEngine(1);
            const wizard = createEnemyEntity("enemy-1", "Cult Wizard", 20, 12, 4, "1d6", {
                initiative: 20,
                spellSaveDC: 14,
                spellSlots: { "2": 1 },
                spells: [{
                    name: "Hold Person",
                    level: 2,
                    school: "enchantment",
                    castingTime: "action",
                    range: 60,
                    savingThrow: "WIS",
                    halfOnSave: false,
                    requiresConcentration: true,
                    conditions: ["paralyzed"],
                    description: "Paralyze a humanoid.",
                }],
            });
            const player = createPlayer({ initiative: 10, abilityScores: { str: 16, dex: 14, con: 14, int: 10, wis: 8, cha: 10 } });

            engine.prepareCombat([wizard, player]);
            engine.submitAction({
                type: "CAST_SPELL",
                casterId: "enemy-1",
                spellName: "Hold Person",
                targetIds: ["player-1"],
            });

            const saveResult = engine.submitSavingThrow("player-1", 5);
            expect(saveResult.success).toBe(true);

            const playerAfter = engine.getState().entities.find(e => e.id === "player-1")!;
            expect(playerAfter.activeConditions.some(c => c.name === "paralyzed")).toBe(true);
        });

        it("does NOT apply conditions when the player succeeds the saving throw", () => {
            const engine = createCombatEngine(1);
            const wizard = createEnemyEntity("enemy-1", "Cult Wizard", 20, 12, 4, "1d6", {
                initiative: 20,
                spellSaveDC: 14,
                spellSlots: { "2": 1 },
                spells: [{
                    name: "Hold Person",
                    level: 2,
                    school: "enchantment",
                    castingTime: "action",
                    range: 60,
                    savingThrow: "WIS",
                    halfOnSave: false,
                    requiresConcentration: true,
                    conditions: ["paralyzed"],
                    description: "Paralyze a humanoid.",
                }],
            });
            // WIS 16 = +3 modifier. Roll 18 + 3 = 21 >= DC 14 → success
            const player = createPlayer({ initiative: 10, abilityScores: { str: 16, dex: 14, con: 14, int: 10, wis: 16, cha: 10 } });

            engine.prepareCombat([wizard, player]);
            engine.submitAction({
                type: "CAST_SPELL",
                casterId: "enemy-1",
                spellName: "Hold Person",
                targetIds: ["player-1"],
            });

            const saveResult = engine.submitSavingThrow("player-1", 18);
            expect(saveResult.success).toBe(true);

            const playerAfter = engine.getState().entities.find(e => e.id === "player-1")!;
            expect(playerAfter.activeConditions.some(c => c.name === "paralyzed")).toBe(false);
            expect(engine.getState().phase).toBe("ACTIVE");
        });
    });

    describe("spatial model", () => {
        it("starts hostile combatants at near range", () => {
            const engine = createCombatEngine(1);
            const player = createPlayer();
            const goblin = createGoblin();

            engine.initiateCombat([player, goblin]);
            const state = engine.getState();

            expect(state.entities.find(e => e.id === "player-1")?.rangeTo["goblin-1"]).toBe(RangeBand.NEAR);
            expect(state.entities.find(e => e.id === "goblin-1")?.rangeTo["player-1"]).toBe(RangeBand.NEAR);
        });

        it("uses MOVE to close from near to melee", () => {
            const engine = createCombatEngine(1);
            engine.initiateCombat([createPlayer(), createGoblin()]);

            const result = engine.submitAction({
                type: "MOVE",
                entityId: "player-1",
                targetId: "goblin-1",
                direction: "toward",
            });

            expect(result.success).toBe(true);
            const player = engine.getState().entities.find(e => e.id === "player-1")!;
            expect(player.rangeTo["goblin-1"]).toBe(RangeBand.MELEE);
            expect(engine.getState().turnResources?.movementUsed).toBe(true);
        });

        it("makes Dash meaningful by allowing a second move band in the same turn", () => {
            const engine = createCombatEngine(1);
            engine.initiateCombat([createPlayer(), createGoblin()]);

            const player = engine.getEntity("player-1")!;
            const goblin = engine.getEntity("goblin-1")!;
            player.rangeTo["goblin-1"] = RangeBand.FAR;
            goblin.rangeTo["player-1"] = RangeBand.FAR;

            expect(engine.submitAction({ type: "DASH", entityId: "player-1" }).success).toBe(true);
            expect(engine.submitAction({ type: "MOVE", entityId: "player-1", targetId: "goblin-1", direction: "toward" }).success).toBe(true);
            expect(engine.submitAction({ type: "MOVE", entityId: "player-1", targetId: "goblin-1", direction: "toward" }).success).toBe(true);

            expect(engine.getEntity("player-1")?.rangeTo["goblin-1"]).toBe(RangeBand.MELEE);
        });

        it("triggers an opportunity attack when leaving melee without disengaging", () => {
            const maxRolls = vi.fn().mockReturnValue({ total: 20, rolls: [20], isCritical: true, isFumble: false });
            const engine = createCombatEngine(1, {}, maxRolls);
            engine.initiateCombat([createPlayer(), createGoblin()]);

            const player = engine.getEntity("player-1")!;
            const goblin = engine.getEntity("goblin-1")!;
            player.rangeTo["goblin-1"] = RangeBand.MELEE;
            goblin.rangeTo["player-1"] = RangeBand.MELEE;

            const result = engine.submitAction({
                type: "MOVE",
                entityId: "player-1",
                targetId: "goblin-1",
                direction: "away",
            });

            expect(result.success).toBe(true);
            expect(engine.getEntity("player-1")?.hp).toBeLessThan(30);
            expect(engine.getEntity("player-1")?.rangeTo["goblin-1"]).toBe(RangeBand.NEAR);
            expect(result.logs.some(log => log.description?.includes("opportunity attack"))).toBe(true);
        });

        it("prevents opportunity attacks after disengaging", () => {
            const maxRolls = vi.fn().mockReturnValue({ total: 20, rolls: [20], isCritical: true, isFumble: false });
            const engine = createCombatEngine(1, {}, maxRolls);
            engine.initiateCombat([createPlayer(), createGoblin()]);

            const player = engine.getEntity("player-1")!;
            const goblin = engine.getEntity("goblin-1")!;
            player.rangeTo["goblin-1"] = RangeBand.MELEE;
            goblin.rangeTo["player-1"] = RangeBand.MELEE;

            expect(engine.submitAction({ type: "DISENGAGE", entityId: "player-1" }).success).toBe(true);
            const hpBefore = engine.getEntity("player-1")!.hp;

            const result = engine.submitAction({
                type: "MOVE",
                entityId: "player-1",
                targetId: "goblin-1",
                direction: "away",
            });

            expect(result.success).toBe(true);
            expect(engine.getEntity("player-1")?.hp).toBe(hpBefore);
            expect(result.logs.some(log => log.description?.includes("opportunity attack"))).toBe(false);
        });

        it("fires a readied attack when the target moves into melee", () => {
            const maxRolls = vi.fn().mockReturnValue({ total: 20, rolls: [20], isCritical: true, isFumble: false });
            const engine = createCombatEngine(1, {}, maxRolls);
            engine.initiateCombat([createPlayer(), createGoblin()]);

            expect(engine.submitAction({
                type: "READY",
                entityId: "player-1",
                trigger: "when the goblin comes within reach",
                readiedAction: "ATTACK",
                targetId: "goblin-1",
            }).success).toBe(true);
            expect(engine.submitAction({ type: "END_TURN", entityId: "player-1" }).success).toBe(true);

            const result = engine.submitAction({
                type: "MOVE",
                entityId: "goblin-1",
                targetId: "player-1",
                direction: "toward",
            });

            expect(result.success).toBe(true);
            expect(result.logs.some(log => log.description?.includes("readied attack triggers"))).toBe(true);
            expect(engine.getEntity("goblin-1")?.hp).toBeLessThan(24);
        });

        it("correctly moves away from a NEAR target to FAR even when also in melee with others", () => {
            const engine = createCombatEngine(1);
            const goblin2 = createEnemyEntity("goblin-2", "Goblin 2", 24, 12, 4, "1d6+2", { initiative: 8 });
            engine.initiateCombat([createPlayer(), createGoblin(), goblin2]);

            // Player is MELEE with goblin-1, NEAR from goblin-2
            const player = engine.getEntity("player-1")!;
            player.rangeTo["goblin-1"] = RangeBand.MELEE;
            engine.getEntity("goblin-1")!.rangeTo["player-1"] = RangeBand.MELEE;
            player.rangeTo["goblin-2"] = RangeBand.NEAR;
            goblin2.rangeTo["player-1"] = RangeBand.NEAR;

            // Disengage first to avoid OA complications
            engine.submitAction({ type: "DISENGAGE", entityId: "player-1" });

            // Move away from goblin-2 (currently NEAR -> should become FAR)
            const result = engine.submitAction({
                type: "MOVE",
                entityId: "player-1",
                targetId: "goblin-2",
                direction: "away",
            });

            expect(result.success).toBe(true);
            expect(engine.getEntity("player-1")?.rangeTo["goblin-2"]).toBe(RangeBand.FAR);
        });
    });
});
