/**
 * Combat Engine
 * Deterministic combat resolution for D&D 5e
 * 
 * This engine handles all mechanical combat operations including:
 * - Initiative tracking and turn order
 * - Attack resolution (hit/miss determination)
 * - Damage calculation and HP tracking
 * - Death detection
 * - Combat state management
 */

import { DiceRoller } from './dice-roller';

// ===== Interfaces =====

export interface CombatantData {
    id?: string;
    name: string;
    type: 'player' | 'enemy';
    characterId?: number;

    // Combat stats
    initiative: number;
    ac: number;
    hpCurrent: number;
    hpMax: number;

    // Enemy-specific (null for players)
    attackBonus?: number;
    damageFormula?: string;
    damageType?: string;
    specialAbilities?: string[];

    // Position
    position?: string;
}

export interface CombatStateData {
    sessionId: number;
    inCombat: boolean;
    round: number;
    combatants: CombatantData[];
    currentTurnIndex: number;
}

export interface AttackResult {
    isHit: boolean;
    attackRoll: number;
    targetAC: number;
    damage?: number;
    targetNewHP?: number;
    targetMaxHP?: number;
    isDead?: boolean;
    isCritical?: boolean;
}

// ===== Combat Engine =====

export class CombatEngine {
    private state: CombatStateData;

    constructor(sessionId: number) {
        this.state = {
            sessionId,
            inCombat: false,
            round: 0,
            combatants: [],
            currentTurnIndex: 0,
        };
    }

    /**
     * Initialize combat mode
     */
    initiateCombat(): void {
        this.state.inCombat = true;
        this.state.round = 1;
        this.state.combatants = [];
        this.state.currentTurnIndex = 0;
    }

    /**
     * Add a player character to combat
     */
    addPlayer(data: {
        characterId: number;
        name: string;
        initiative: number;
        ac: number;
        hpCurrent: number;
        hpMax: number;
        position?: string;
    }): void {
        const combatant: CombatantData = {
            id: `player-${data.characterId}`,
            name: data.name,
            type: 'player',
            characterId: data.characterId,
            initiative: data.initiative,
            ac: data.ac,
            hpCurrent: data.hpCurrent,
            hpMax: data.hpMax,
            position: data.position,
        };

        this.state.combatants.push(combatant);
    }

    /**
     * Add an enemy to combat
     */
    addEnemy(data: {
        name: string;
        initiative: number;
        ac: number;
        hpMax: number;
        attackBonus: number;
        damageFormula: string;
        damageType?: string;
        specialAbilities?: string[];
        position?: string;
    }): void {
        const combatant: CombatantData = {
            id: `enemy-${Date.now()}-${Math.random()}`,
            name: data.name,
            type: 'enemy',
            initiative: data.initiative,
            ac: data.ac,
            hpCurrent: data.hpMax,
            hpMax: data.hpMax,
            attackBonus: data.attackBonus,
            damageFormula: data.damageFormula,
            damageType: data.damageType || 'slashing',
            specialAbilities: data.specialAbilities || [],
            position: data.position,
        };

        this.state.combatants.push(combatant);
    }

    /**
     * Sort combatants by initiative (descending)
     * Ties broken by higher DEX (for now, just preserve order)
     */
    sortInitiative(): void {
        this.state.combatants.sort((a, b) => b.initiative - a.initiative);
    }

    /**
     * Get current combatant whose turn it is
     */
    getCurrentCombatant(): CombatantData | null {
        if (this.state.combatants.length === 0) return null;
        return this.state.combatants[this.state.currentTurnIndex] || null;
    }

    /**
     * Get next combatant in turn order
     */
    getNextCombatant(): CombatantData | null {
        if (this.state.combatants.length === 0) return null;
        const nextIndex = (this.state.currentTurnIndex + 1) % this.state.combatants.length;
        return this.state.combatants[nextIndex] || null;
    }

    /**
     * Advance to next turn
     * Returns the new current combatant
     */
    advanceTurn(): CombatantData | null {
        if (this.state.combatants.length === 0) return null;

        this.state.currentTurnIndex++;

        // If we've wrapped around, increment round
        if (this.state.currentTurnIndex >= this.state.combatants.length) {
            this.state.currentTurnIndex = 0;
            this.state.round++;
        }

        return this.getCurrentCombatant();
    }

    /**
     * Resolve an attack - deterministic hit/miss and damage calculation
     */
    resolveAttack(
        attackRoll: number,
        targetName: string,
        damage?: number
    ): AttackResult {
        const target = this.state.combatants.find(c => c.name === targetName);

        if (!target) {
            throw new Error(`Target not found: ${targetName}`);
        }

        const isCritical = attackRoll === 20;
        const isHit = attackRoll >= target.ac || isCritical;

        const result: AttackResult = {
            isHit,
            isCritical,
            attackRoll,
            targetAC: target.ac,
        };

        if (isHit && damage !== undefined) {
            // Apply damage
            const actualDamage = Math.max(0, damage);
            const newHP = Math.max(0, target.hpCurrent - actualDamage);

            target.hpCurrent = newHP;

            result.damage = actualDamage;
            result.targetNewHP = newHP;
            result.targetMaxHP = target.hpMax;
            result.isDead = newHP === 0;

            // Remove from combat if dead
            if (result.isDead) {
                this.removeCombatant(targetName);
            }
        }

        return result;
    }

    /**
     * Remove a combatant from combat (when they die or flee)
     */
    removeCombatant(name: string): void {
        const index = this.state.combatants.findIndex(c => c.name === name);
        if (index !== -1) {
            this.state.combatants.splice(index, 1);

            // Adjust currentTurnIndex if needed
            if (this.state.currentTurnIndex >= this.state.combatants.length) {
                this.state.currentTurnIndex = 0;
            }
        }
    }

    /**
     * Check if combat has ended
     */
    isCombatEnded(): boolean {
        const hasPlayers = this.state.combatants.some(c => c.type === 'player');
        const hasEnemies = this.state.combatants.some(c => c.type === 'enemy');

        // Combat ends when either side is completely eliminated
        return !hasPlayers || !hasEnemies;
    }

    /**
     * Get combat victory status
     */
    getVictoryStatus(): 'players' | 'enemies' | 'ongoing' {
        const hasPlayers = this.state.combatants.some(c => c.type === 'player');
        const hasEnemies = this.state.combatants.some(c => c.type === 'enemy');

        if (!hasEnemies && hasPlayers) return 'players';
        if (!hasPlayers && hasEnemies) return 'enemies';
        return 'ongoing';
    }

    /**
     * End combat and clean up
     */
    endCombat(): void {
        this.state.inCombat = false;
        this.state.round = 0;
        this.state.currentTurnIndex = 0;
        // Keep combatants for potential summary/XP calculations
    }

    /**
     * Get current combat state
     */
    getState(): CombatStateData {
        return { ...this.state };
    }

    /**
     * Get all combatants
     */
    getCombatants(): CombatantData[] {
        return [...this.state.combatants];
    }

    /**
     * Get combatants by type
     */
    getCombatantsByType(type: 'player' | 'enemy'): CombatantData[] {
        return this.state.combatants.filter(c => c.type === type);
    }

    /**
     * Get a specific combatant by name
     */
    getCombatant(name: string): CombatantData | undefined {
        return this.state.combatants.find(c => c.name === name);
    }

    /**
     * Auto-roll enemy attack
     */
    rollEnemyAttack(enemyName: string): number {
        const enemy = this.getCombatant(enemyName);
        if (!enemy || enemy.type !== 'enemy' || !enemy.attackBonus) {
            throw new Error(`Invalid enemy for attack: ${enemyName}`);
        }

        const d20 = DiceRoller.rollD20();
        return d20 + enemy.attackBonus;
    }

    /**
     * Auto-roll enemy damage
     */
    rollEnemyDamage(enemyName: string): number {
        const enemy = this.getCombatant(enemyName);
        if (!enemy || enemy.type !== 'enemy' || !enemy.damageFormula) {
            throw new Error(`Invalid enemy for damage: ${enemyName}`);
        }

        return DiceRoller.roll(enemy.damageFormula);
    }
}
