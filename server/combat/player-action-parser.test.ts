import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockEngine, mockInvokeLLMWithSettings } = vi.hoisted(() => ({
    mockEngine: {
        getState: vi.fn(),
        getCurrentTurnEntity: vi.fn(),
    },
    mockInvokeLLMWithSettings: vi.fn(),
}));

vi.mock("./combat-engine-manager", () => ({
    CombatEngineManager: {
        get: vi.fn(() => mockEngine),
    },
}));

vi.mock("../llm-with-settings", () => ({
    invokeLLMWithSettings: mockInvokeLLMWithSettings,
}));

vi.mock("../activity-log", () => ({
    activity: {
        parser: vi.fn(),
    },
}));

import { parsePlayerAction } from "./player-action-parser";

describe("parsePlayerAction", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockEngine.getState.mockReturnValue({
            phase: "ACTIVE",
            entities: [
                { id: "player-1", name: "Silas Gravemourn", type: "player", status: "ALIVE", spells: [] },
                { id: "enemy-1", name: "Goblin", type: "enemy", status: "ALIVE" },
            ],
        });
        mockEngine.getCurrentTurnEntity.mockReturnValue({
            id: "player-1",
            name: "Silas Gravemourn",
            type: "player",
            status: "ALIVE",
            spells: [],
        });
    });

    it("treats direct question-form combat messages as queries without calling the LLM", async () => {
        const result = await parsePlayerAction(77, 1, "can I ready an attack?");

        expect(result.error).toBe("QUERY");
        expect(result.action.type).toBe("END_TURN");
        expect(mockInvokeLLMWithSettings).not.toHaveBeenCalled();
    });
});
