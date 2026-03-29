/**
 * Combat UI behaviour tests
 *
 * These tests simulate what the UI does (getState, submitRoll, submitAction)
 * and assert on the same data the sidebar and dice roller would see.
 * They verify the "what should be different" behaviours from Stage 1.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../db", () => ({
  saveCombatEngineState: vi.fn().mockResolvedValue(undefined),
  deleteCombatEngineState: vi.fn().mockResolvedValue(undefined),
  loadCombatEngineState: vi.fn().mockResolvedValue(null),
}));

import { CombatEngineManager } from "../combat-engine-manager";
import { createPlayerEntity, createEnemyEntity } from "../combat-types";

// Build the same shape the router's getState returns for the UI (log, pendingRoll, etc.)
function getStateForUI(sessionId: number): {
  phase: string;
  round: number;
  log: Array<{ type: string; description?: string }>;
  pendingRoll: {
    type: string;
    formula: string;
    isCritical?: boolean;
    prompt: string;
  } | null;
  entities: Array<{ id: string; name: string; hp: number; status: string }>;
} | null {
  const engine = CombatEngineManager.get(sessionId);
  if (!engine) return null;

  const state = engine.getState();

  const pendingRoll = (() => {
    if (state.phase === "AWAIT_ATTACK_ROLL" && state.pendingAttackRoll) {
      const attacker = engine.getEntity(state.pendingAttackRoll.attackerId);
      const target = engine.getEntity(state.pendingAttackRoll.targetId);
      return {
        type: "attack",
        formula: "1d20",
        prompt: `${attacker?.name} rolls to hit ${target?.name}`,
      };
    }
    if (state.phase === "AWAIT_DAMAGE_ROLL" && state.pendingAttack) {
      const attacker = engine.getEntity(state.pendingAttack.attackerId);
      const target = engine.getEntity(state.pendingAttack.targetId);
      return {
        type: "damage",
        formula: state.pendingAttack.damageFormula,
        isCritical: state.pendingAttack.isCritical,
        prompt: `${attacker?.name} rolls damage against ${target?.name}`,
      };
    }
    return null;
  })();

  return {
    phase: state.phase,
    round: state.round,
    log: state.log.slice(-20).map((l) => ({ type: l.type, description: l.description })),
    pendingRoll,
    entities: state.entities.map((e) => ({ id: e.id, name: e.name, hp: e.hp, status: e.status })),
  };
}

const TEST_SESSION = 88881;

describe("Combat UI behaviour (Stage 1)", () => {
  beforeEach(async () => {
    await CombatEngineManager.destroy(TEST_SESSION);
  });

  describe("Log persistence (UI sees combat log)", () => {
    it("getState().log has entries after combat start and attack", async () => {
      const engine = CombatEngineManager.getOrCreate(TEST_SESSION);
      const player = createPlayerEntity("p1", "Hero", 30, 30, 15, 20, { attackModifier: 5 });
      const goblin = createEnemyEntity("goblin-1", "Goblin", 7, 10, 3, "1d4", { initiative: 10 });
      engine.prepareCombat([player, goblin]);
      // Skip initiative wait: set initiative so combat starts
      const state0 = engine.getState();
      if (state0.phase === "AWAIT_INITIATIVE" && state0.pendingInitiative) {
        engine.applyInitiative(state0.pendingInitiative.pendingEntityIds[0], 15);
      }

      let uiState = getStateForUI(TEST_SESSION);
      expect(uiState).not.toBeNull();
      expect(uiState!.log.length).toBeGreaterThan(0);
      expect(uiState!.log.some((l) => l.type === "COMBAT_START")).toBe(true);

      // Player attacks (with roll so we get through to damage phase)
      engine.submitAction({
        type: "ATTACK",
        attackerId: "p1",
        targetId: "goblin-1",
        attackRoll: 15,
        rawD20: 10,
      });
      if (engine.getState().phase === "AWAIT_DAMAGE_ROLL") {
        engine.applyDamage(5);
      }

      uiState = getStateForUI(TEST_SESSION);
      expect(uiState!.log.length).toBeGreaterThan(1);
      expect(uiState!.log.some((l) => l.type === "ATTACK_ROLL")).toBe(true);

      // Apply damage (same as UI after dice roller submits damage); must be valid for formula 1d4 (1-4)
      if (engine.getState().phase === "AWAIT_DAMAGE_ROLL") {
        engine.applyDamage(3);
      }
      // UI reads via getState(); log should persist (Stage 1 fix)
      const stateAfterDamage = engine.getState();
      expect(stateAfterDamage.log.length).toBeGreaterThan(2);
      expect(
        stateAfterDamage.log.some((l) => l.type === "DAMAGE" || l.type === "TURN_END")
      ).toBe(true);
      uiState = getStateForUI(TEST_SESSION);
      expect(uiState!.log.length).toBe(stateAfterDamage.log.length);
    });
  });

  describe("Nat 20 = crit (dice roller path)", () => {
    it("submitting raw d20 = 20 shows critical hit and double damage in pendingRoll", async () => {
      const engine = CombatEngineManager.getOrCreate(TEST_SESSION);
      const player = createPlayerEntity("p1", "Hero", 30, 30, 15, 20, { attackModifier: 5 });
      const goblin = createEnemyEntity("goblin-1", "Goblin", 7, 10, 3, "1d4", { initiative: 10 });
      engine.prepareCombat([player, goblin]);
      const state0 = engine.getState();
      if (state0.phase === "AWAIT_INITIATIVE" && state0.pendingInitiative) {
        engine.applyInitiative(state0.pendingInitiative.pendingEntityIds[0], 15);
      }

      engine.submitAction({ type: "ATTACK", attackerId: "p1", targetId: "goblin-1" });
      expect(engine.getState().phase).toBe("AWAIT_ATTACK_ROLL");

      // UI dice roller sends rawDieValue 20
      engine.resolveAttackRoll(20);

      const state = engine.getState();
      expect(state.phase).toBe("AWAIT_DAMAGE_ROLL");
      expect(state.pendingAttack?.isCritical).toBe(true);
      // Double dice: 1d4 -> 2d4
      expect(state.pendingAttack?.damageFormula).toMatch(/2d4/);

      const uiState = getStateForUI(TEST_SESSION);
      expect(uiState!.pendingRoll?.type).toBe("damage");
      expect(uiState!.pendingRoll?.isCritical).toBe(true);
    });
  });

  describe("Nat 1 = fumble (dice roller path)", () => {
    it("submitting raw d20 = 1 ends turn with no damage phase", async () => {
      const engine = CombatEngineManager.getOrCreate(TEST_SESSION);
      const player = createPlayerEntity("p1", "Hero", 30, 30, 15, 20, { attackModifier: 5 });
      const goblin = createEnemyEntity("goblin-1", "Goblin", 7, 10, 3, "1d4", { initiative: 10 });
      engine.prepareCombat([player, goblin]);
      const state0 = engine.getState();
      if (state0.phase === "AWAIT_INITIATIVE" && state0.pendingInitiative) {
        engine.applyInitiative(state0.pendingInitiative.pendingEntityIds[0], 15);
      }

      engine.submitAction({ type: "ATTACK", attackerId: "p1", targetId: "goblin-1" });
      engine.resolveAttackRoll(1);

      const state = engine.getState();
      expect(state.phase).not.toBe("AWAIT_DAMAGE_ROLL");
      expect(state.pendingAttack).toBeUndefined();
      // After a miss, player still has bonus action — turn should NOT auto-end
      // but there should be no damage phase
      const uiState = getStateForUI(TEST_SESSION);
      expect(uiState!.pendingRoll?.type).not.toBe("damage");
      // Verify it's still the player's turn (action used, but bonus action remains)
      expect(state.phase).toBe("ACTIVE");
    });
  });

  describe("Round increments when skipping dead entities", () => {
    it("after killing all enemies and ending turn, UI sees Round 2", async () => {
      const engine = CombatEngineManager.getOrCreate(TEST_SESSION);
      const player = createPlayerEntity("p1", "Hero", 30, 30, 15, 20, {
        attackModifier: 5,
        damageFormula: "2d6",
      });
      const e1 = createEnemyEntity("e1", "Orc", 5, 10, 3, "1d4", { initiative: 10 });
      const e2 = createEnemyEntity("e2", "Goblin", 5, 10, 2, "1d4", { initiative: 5 });
      engine.prepareCombat([player, e1, e2]);
      const state0 = engine.getState();
      if (state0.phase === "AWAIT_INITIATIVE" && state0.pendingInitiative) {
        engine.applyInitiative(state0.pendingInitiative.pendingEntityIds[0], 15);
      }

      expect(getStateForUI(TEST_SESSION)!.round).toBe(1);

      // Player kills e1
      engine.submitAction({
        type: "ATTACK",
        attackerId: "p1",
        targetId: "e1",
        attackRoll: 15,
        rawD20: 10,
      });
      if (engine.getState().phase === "AWAIT_DAMAGE_ROLL") engine.applyDamage(12);

      // Player kills e2 (turn may have advanced to e2 or back to player depending on order)
      const s = engine.getState();
      if (s.phase === "ACTIVE" && engine.getCurrentTurnEntity()?.id === "p1") {
        engine.submitAction({
          type: "ATTACK",
          attackerId: "p1",
          targetId: "e2",
          attackRoll: 15,
          rawD20: 10,
        });
        if (engine.getState().phase === "AWAIT_DAMAGE_ROLL") engine.applyDamage(12);
      }

      // End turn until we wrap (player may need to end turn to advance past dead e1/e2)
      let phase = engine.getState().phase;
      let round = engine.getState().round;
      for (let i = 0; i < 5 && phase !== "RESOLVED"; i++) {
        const currentId = engine.getCurrentTurnEntity()?.id;
        if (currentId) engine.submitAction({ type: "END_TURN", entityId: currentId });
        phase = engine.getState().phase;
        round = engine.getState().round;
        if (round >= 2) break;
      }

      expect(round).toBe(2);
      expect(getStateForUI(TEST_SESSION)!.round).toBe(2);
    });
  });
});
