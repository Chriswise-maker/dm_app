import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSaveMessage = vi.fn().mockResolvedValue({ id: 1 });
const mockParsePlayerAction = vi.fn();
const mockIsPlayerTurn = vi.fn();
const mockPersist = vi.fn().mockResolvedValue(undefined);

const mockEngineState = {
    phase: "ACTIVE",
    turnOrder: ["player-1"],
    turnIndex: 0,
    turnResources: {
        actionUsed: true,
        bonusActionUsed: false,
        reactionUsed: false,
        movementUsed: false,
        extraAttacksRemaining: 0,
    },
    entities: [
        {
            id: "player-1",
            name: "Silas Gravemourn",
            type: "player",
            hp: 24,
            maxHp: 24,
            baseAC: 16,
        },
    ],
};

const mockEngine = {
    getState: vi.fn(() => mockEngineState),
    submitAction: vi.fn(() => ({
        success: false,
        logs: [],
        newState: mockEngineState,
        error: "No action available for Ready",
    })),
};

vi.mock("./db", () => ({
    getCharacter: vi.fn().mockResolvedValue({
        id: 1,
        sessionId: 77,
        name: "Silas Gravemourn",
        className: "Rogue",
        level: 3,
        hpCurrent: 24,
        hpMax: 24,
        ac: 16,
        stats: JSON.stringify({ str: 10, dex: 18, con: 14, int: 12, wis: 13, cha: 11 }),
        inventory: JSON.stringify(["dagger"]),
        notes: "",
    }),
    getSession: vi.fn().mockResolvedValue({
        id: 77,
        userId: 1,
        narrativePrompt: null,
        currentSummary: null,
    }),
    getSessionMessages: vi.fn().mockResolvedValue([]),
    getSessionContext: vi.fn().mockResolvedValue(undefined),
    parseSessionContext: vi.fn().mockReturnValue({}),
    getCombatState: vi.fn().mockResolvedValue(undefined),
    saveMessage: mockSaveMessage,
}));

vi.mock("./llm-with-settings", () => ({
    invokeLLMWithSettings: vi.fn(),
    invokeLLMWithSettingsStream: vi.fn(),
}));

vi.mock("./prompts", () => ({
    buildChatSystemPrompt: vi.fn(),
    buildChatUserPrompt: vi.fn(),
    buildCombatQueryPrompt: vi.fn(),
    formatCharacterSheet: vi.fn().mockReturnValue("Name: Silas Gravemourn\nClass: Rogue Level 3"),
    formatCharacterSheetForCombat: vi.fn().mockReturnValue("Name: Silas Gravemourn\nClass: Rogue Level 3"),
    getSkillProficiencies: vi.fn().mockReturnValue([]),
}));

vi.mock("./response-parser", () => ({
    parseStructuredResponse: vi.fn(),
    hasCombatInitiation: vi.fn(),
    hasCombatEnd: vi.fn(),
    getEnemies: vi.fn(),
}));

vi.mock("./combat/combat-helpers", () => ({
    handleAutoCombatInitiation: vi.fn(),
    handleAutoCombatEnd: vi.fn(),
}));

vi.mock("./combat/combat-engine-manager", () => ({
    CombatEngineManager: {
        get: vi.fn(() => mockEngine),
        persist: mockPersist,
    },
}));

vi.mock("./combat/player-action-parser", () => ({
    isPlayerTurn: mockIsPlayerTurn,
    parsePlayerAction: mockParsePlayerAction,
}));

vi.mock("./combat/combat-narrator", () => ({
    generateCombatNarrativeStream: vi.fn(),
}));

import { executeMessageSend } from "./message-send";

describe("executeMessageSend combat chat wiring", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsPlayerTurn.mockReturnValue(true);
        mockParsePlayerAction.mockResolvedValue({
            action: {
                type: "READY",
                entityId: "player-1",
                trigger: "when the goblin comes within reach",
                readiedAction: "ATTACK",
                targetId: "enemy-1",
            },
            flavorText: "I ready an attack",
            confidence: 0.95,
        });
    });

    it("returns engine action errors to chat instead of narrating an empty result", async () => {
        const result = await executeMessageSend(
            { user: { id: 1 } } as any,
            {
                sessionId: 77,
                characterId: 1,
                message: "I ready an attack",
            }
        );

        expect(result.response).toBe("You can't ready right now because your action is already spent.");
        expect(mockSaveMessage).toHaveBeenCalledTimes(2);
        expect(mockPersist).not.toHaveBeenCalled();
    });
});
