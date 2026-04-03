import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Dices } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { rollFormula, parseFormula } from '@/lib/dice-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PendingRoll {
  type: 'initiative' | 'attack' | 'damage' | 'save' | 'deathSave';
  formula: string;       // e.g. "1d20", "2d20" (adv/disadv), "1d8+3", "2d8+3" (critical)
  modifier?: number;     // attack modifier shown separately (e.g. +5 for attack rolls)
  advantage?: boolean;   // roll 2d20 keep highest
  disadvantage?: boolean; // roll 2d20 keep lowest
  entityId?: string;     // relevant entity (for initiative)
  entityName: string;
  targetName?: string;
  isCritical?: boolean;
  prompt: string;        // display label, e.g. "Roll to hit Goblin (d20+5)"
}

interface DiceRollerProps {
  pendingRoll: PendingRoll;
  sessionId: number;
  onRollComplete?: () => void;
}

type AnimState = 'idle' | 'rolling' | 'result' | 'submitting';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DiceRoller({ pendingRoll, sessionId, onRollComplete }: DiceRollerProps) {
  const [animState, setAnimState] = useState<AnimState>('idle');
  const [displayRolls, setDisplayRolls] = useState<number[]>([1]);
  const [finalResult, setFinalResult] = useState<{ rolls: number[]; total: number; modifier: number } | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const parsed = parseFormula(pendingRoll.formula);
  const dieCount = parsed?.count ?? 1;
  const dieSides = parsed?.sides ?? 20;

  // For attack rolls, modifier comes from pendingRoll.modifier.
  // For damage rolls, modifier is baked into the formula (e.g. "1d8+3").
  // For initiative, modifier is also in pendingRoll.modifier (shown for info only).
  const displayModifier = pendingRoll.type === 'damage'
    ? (parsed?.modifier ?? 0)
    : (pendingRoll.modifier ?? 0);

  const submitRoll = trpc.combatV2.submitRoll.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        onRollComplete?.();
      } else {
        toast.error((data as any).error || 'Roll failed');
        setAnimState('idle');
      }
    },
    onError: (err) => {
      toast.error(err.message);
      setAnimState('idle');
    },
  });

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (rollTimeoutRef.current) clearTimeout(rollTimeoutRef.current);
      if (submitTimeoutRef.current) clearTimeout(submitTimeoutRef.current);
    };
  }, []);

  // Reset when the needed roll type changes (e.g. initiative → damage)
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (rollTimeoutRef.current) clearTimeout(rollTimeoutRef.current);
    if (submitTimeoutRef.current) clearTimeout(submitTimeoutRef.current);
    setAnimState('idle');
    setFinalResult(null);
    setDisplayRolls(Array(dieCount).fill(1));
  }, [pendingRoll.type, pendingRoll.formula, dieCount, pendingRoll.entityId]);

  const handleRoll = () => {
    if (animState !== 'idle') return;

    const result = rollFormula(pendingRoll.formula);
    if (!result) {
      toast.error(`Cannot parse dice formula: ${pendingRoll.formula}`);
      return;
    }

    setFinalResult(result);
    setAnimState('rolling');

    // Rapidly cycle displayed numbers
    const randomRolls = () => result.rolls.map(() => Math.floor(Math.random() * dieSides) + 1);
    setDisplayRolls(randomRolls());
    intervalRef.current = setInterval(() => {
      setDisplayRolls(randomRolls());
    }, 80);

    // After 1.2s: stop cycling, show result
    rollTimeoutRef.current = setTimeout(() => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setDisplayRolls(result.rolls);
      setAnimState('result');

      // After 700ms: auto-submit
      submitTimeoutRef.current = setTimeout(() => {
        setAnimState('submitting');

        // initiative & attack → send the kept raw d20 value
        // advantage: keep highest; disadvantage: keep lowest
        // damage → send the total (formula already includes modifier)
        let rawDieValue: number;
        if (pendingRoll.type === 'damage') {
          rawDieValue = result.total;
        } else if (pendingRoll.advantage && result.rolls.length >= 2) {
          rawDieValue = Math.max(...result.rolls);
        } else if (pendingRoll.disadvantage && result.rolls.length >= 2) {
          rawDieValue = Math.min(...result.rolls);
        } else {
          rawDieValue = result.rolls[0];
        }

        submitRoll.mutate({
          sessionId,
          rollType: pendingRoll.type,
          rawDieValue,
          entityId: pendingRoll.entityId,
        });
      }, 700);
    }, 1200);
  };

  // For advantage/disadvantage, determine which die is kept
  const keptD20 = finalResult
    ? pendingRoll.advantage && finalResult.rolls.length >= 2
      ? Math.max(...finalResult.rolls)
      : pendingRoll.disadvantage && finalResult.rolls.length >= 2
        ? Math.min(...finalResult.rolls)
        : finalResult.rolls[0]
    : null;

  // Detect nat 20 / nat 1 on the kept die
  const isNatTwenty = keptD20 === 20 && pendingRoll.type !== 'damage';
  const isNatOne = keptD20 === 1 && pendingRoll.type !== 'damage';

  // Total shown in breakdown row — for adv/disadv use the kept die, not sum
  const totalDisplay = finalResult
    ? pendingRoll.type === 'damage'
      ? finalResult.total                           // formula already has modifier baked in
      : (keptD20 ?? finalResult.rolls[0]) + displayModifier  // kept d20 + attack/init modifier
    : null;

  const showResult = animState === 'result' || animState === 'submitting';

  return (
    <div className="mx-3 my-2 p-3 rounded-xl bg-stone-800/95 border border-amber-600/60 shadow-lg">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <Dices className="h-4 w-4 text-amber-500 flex-shrink-0" />
        <p className="text-xs font-semibold text-amber-200 leading-tight">{pendingRoll.prompt}</p>
      </div>

      {/* Critical hit badge */}
      {pendingRoll.isCritical && (
        <div className="mb-2 text-center text-[11px] font-bold text-amber-400 tracking-widest uppercase">
          ⚡ Critical Hit — Double Dice!
        </div>
      )}

      {/* Dice faces row */}
      <div className="flex items-center justify-center gap-2 mb-3 min-h-[60px]">
        {Array.from({ length: dieCount }).map((_, i) => {
          const val = displayRolls[i] ?? '?';
          // For advantage/disadvantage, dim the non-kept die after rolling
          const isKept = !finalResult || dieCount === 1
            ? true
            : pendingRoll.advantage
              ? displayRolls[i] === Math.max(...displayRolls)
              : pendingRoll.disadvantage
                ? displayRolls[i] === Math.min(...displayRolls)
                : true;
          return (
            <motion.div
              key={i}
              className={[
                'w-14 h-14 rounded-lg border-2 flex items-center justify-center',
                'text-2xl font-bold select-none cursor-default transition-opacity',
                !isKept ? 'opacity-30' : '',
                isNatTwenty
                  ? 'border-yellow-400 bg-yellow-900/50 text-yellow-200'
                  : isNatOne
                    ? 'border-red-500 bg-red-900/40 text-red-300'
                    : 'border-amber-600 bg-stone-900 text-amber-100',
              ].join(' ')}
              animate={
                animState === 'rolling'
                  ? { rotate: [0, 14, -14, 9, -9, 0] }
                  : animState === 'result'
                    ? { scale: [1.4, 1] }
                    : { scale: 1, rotate: 0 }
              }
              transition={
                animState === 'rolling'
                  ? { duration: 0.45, repeat: Infinity, repeatType: 'loop' }
                  : animState === 'result'
                    ? { type: 'spring', stiffness: 450, damping: 18, delay: i * 0.07 }
                    : { duration: 0.2 }
              }
            >
              {val}
            </motion.div>
          );
        })}

        {/* Flat modifier indicator (shown alongside dice) */}
        {displayModifier !== 0 && (
          <span className="text-lg font-semibold text-stone-400">
            {displayModifier > 0 ? '+' : ''}{displayModifier}
          </span>
        )}
      </div>

      {/* Breakdown / total row — revealed after rolling */}
      {showResult && finalResult && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="text-center mb-3"
        >
          {displayModifier !== 0 ? (
            <p className="text-sm text-stone-300">
              {finalResult.rolls.join(' + ')}
              {' '}
              <span className="text-stone-500">{displayModifier > 0 ? '+' : ''}{displayModifier}</span>
              {' = '}
              <span className="text-amber-300 font-bold text-base">{totalDisplay}</span>
            </p>
          ) : (
            <p className="text-base font-bold text-amber-300">{totalDisplay}</p>
          )}

          {isNatTwenty && (
            <p className="text-[11px] font-bold text-yellow-400 mt-1 tracking-widest">⭐ NAT 20!</p>
          )}
          {isNatOne && (
            <p className="text-[11px] font-bold text-red-400 mt-1 tracking-widest">💀 NAT 1!</p>
          )}
        </motion.div>
      )}

      {/* Roll button */}
      <button
        onClick={handleRoll}
        disabled={animState !== 'idle'}
        className={[
          'w-full py-2 rounded-lg font-semibold text-sm transition-colors',
          animState === 'idle'
            ? 'bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white cursor-pointer'
            : 'bg-stone-700 text-stone-500 cursor-not-allowed',
        ].join(' ')}
      >
        {animState === 'idle' && '🎲 Roll!'}
        {animState === 'rolling' && 'Rolling…'}
        {animState === 'result' && 'Locked in…'}
        {animState === 'submitting' && (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Submitting…
          </span>
        )}
      </button>
    </div>
  );
}
