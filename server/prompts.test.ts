import { describe, expect, it } from "vitest";

import { buildChatUserPrompt, buildCombatQueryPrompt } from "./prompts";
import { BattleStateSchema, RangeBand, createEnemyEntity, createPlayerEntity } from "./combat/combat-types";

function createActiveBattleState() {
    const silas = createPlayerEntity("player-1", "Silas Gravemourn", 27, 32, 16, 12, {
        dbCharacterId: 1,
    });
    const mira = createPlayerEntity("player-2", "Mira Vale", 18, 22, 14, 18, {
        dbCharacterId: 2,
    });
    const goblin = createEnemyEntity("enemy-1", "Goblin Archer", 9, 13, 4, "1d6+2", {
        initiative: 9,
    });

    silas.rangeTo[mira.id] = RangeBand.MELEE;
    mira.rangeTo[silas.id] = RangeBand.MELEE;
    silas.rangeTo[goblin.id] = RangeBand.NEAR;
    goblin.rangeTo[silas.id] = RangeBand.NEAR;
    mira.rangeTo[goblin.id] = RangeBand.FAR;
    goblin.rangeTo[mira.id] = RangeBand.FAR;

    return BattleStateSchema.parse({
        id: "battle-1",
        sessionId: 77,
        entities: [silas, goblin, mira],
        turnOrder: [mira.id, silas.id, goblin.id],
        round: 2,
        turnIndex: 0,
        phase: "ACTIVE",
        log: [],
        history: [],
        settings: {
            aiModels: { minionTier: "gpt-4o-mini", bossTier: "gpt-4o" },
            debugMode: false,
        },
        createdAt: 1,
        updatedAt: 1,
    });
}

describe("prompts combat context", () => {
    it("uses turnOrder for the current turn and includes range bands in the V2 chat prompt", () => {
        const battleState = createActiveBattleState();

        const prompt = buildChatUserPrompt(
            {
                id: 1,
                name: "Silas Gravemourn",
                className: "Rogue",
                level: 3,
                hpCurrent: 27,
                hpMax: 32,
                ac: 16,
                notes: "A grave-touched investigator.",
            } as any,
            { str: 10, dex: 18, con: 14, int: 12, wis: 13, cha: 11 },
            ["dagger", "thieves' tools"],
            {} as any,
            [],
            {},
            undefined,
            [],
            "how far are my enemies away?",
            battleState
        );

        expect(prompt).toContain("[COMBAT ENGINE V2 - ACTIVE]");
        expect(prompt).toContain("Current Turn: Mira Vale (Initiative: 18)");
        expect(prompt).toContain("Relative Positioning for Silas Gravemourn:");
        expect(prompt).toContain("Goblin Archer (enemy): near (30 ft)");
        expect(prompt).toContain("Mira Vale (player): melee (5 ft)");
        expect(prompt).toContain("Range bands are the authoritative battlefield positions.");
    });

    it("builds combat query prompts with battlefield snapshot instead of asking for a map", () => {
        const battleState = createActiveBattleState();

        const prompt = buildCombatQueryPrompt({
            battleState,
            focusEntityId: "player-1",
            playerName: "Silas Gravemourn",
            playerHp: 27,
            playerMaxHp: 32,
            playerAc: 16,
            resourceStatus: "**Action** (available), **Bonus Action** (available), **Reaction** (available)",
            actionList: "• **MOVE** — Move toward Goblin Archer (near -> melee)\n• **END_TURN** — End your turn",
            question: "how far are my enemies away? where am I?",
        });

        expect(prompt).toContain("Do NOT say you need a tactical map or enemy positions.");
        expect(prompt).toContain("BATTLEFIELD SNAPSHOT:");
        expect(prompt).toContain("Current Turn: Mira Vale (Initiative: 18)");
        expect(prompt).toContain("Goblin Archer (enemy): near (30 ft)");
        expect(prompt).toContain('PLAYER\'S QUESTION: "how far are my enemies away? where am I?"');
    });
});
