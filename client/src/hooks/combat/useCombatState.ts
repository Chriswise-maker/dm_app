import { useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc';

export interface CombatState {
    inCombat: boolean;
    round: number;
    currentTurnIndex: number;
    combatants: Array<{
        id: number;
        name: string;
        type: 'player' | 'enemy';
        initiative: number;
        ac: number;
        hpCurrent: number;
        hpMax: number;
        attackBonus: number | null;
        damageFormula: string | null;
        damageType: string | null;
        position: string | null;
    }>;
    currentTurn: {
        name: string;
        type: 'player' | 'enemy';
        initiative: number;
    } | null;
}

/**
 * Custom hook for managing combat state
 * Provides combat data and operations for a session
 */
export function useCombatState(sessionId: number | null) {
    const [combatInitiated, setCombatInitiated] = useState(false);

    // Query combat state
    const { data: combatState, refetch: refetchCombatState } = trpc.combat.getState.useQuery(
        { sessionId: sessionId! },
        {
            enabled: !!sessionId,
            refetchInterval: combatInitiated ? 2000 : false, // Poll every 2s during combat
        }
    );

    // Update combatInitiated flag when combat state changes
    useEffect(() => {
        if (combatState?.inCombat) {
            setCombatInitiated(true);
        } else if (combatInitiated && combatState && !combatState.inCombat) {
            // Combat ended
            setCombatInitiated(false);
        }
    }, [combatState?.inCombat]);

    // Combat mutations
    const initiateCombat = trpc.combat.initiate.useMutation({
        onSuccess: () => {
            setCombatInitiated(true);
            refetchCombatState();
        },
    });

    const addPlayer = trpc.combat.addPlayer.useMutation({
        onSuccess: () => refetchCombatState(),
    });

    const sortInitiative = trpc.combat.sortInitiative.useMutation({
        onSuccess: () => refetchCombatState(),
    });

    const resolveAttack = trpc.combat.resolveAttack.useMutation({
        onSuccess: () => refetchCombatState(),
    });

    const advanceTurn = trpc.combat.advanceTurn.useMutation({
        onSuccess: () => refetchCombatState(),
    });

    const endCombat = trpc.combat.end.useMutation({
        onSuccess: () => {
            setCombatInitiated(false);
            refetchCombatState();
        },
    });

    return {
        combatState,
        refetchCombatState,
        initiateCombat,
        addPlayer,
        sortInitiative,
        resolveAttack,
        advanceTurn,
        endCombat,
    };
}
