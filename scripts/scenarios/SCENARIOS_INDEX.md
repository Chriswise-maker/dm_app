# Chat scenario library

All files are JSON for `npx tsx scripts/chat-test.ts --scenario scripts/scenarios/<file>.json`.

**Defaults in this library:** `sessionId` **25**, Silas `characterId` **26**. Replace with your dev DB. **`combat-dual-initiative-mira.json`** uses **`characterId` 27** for Mira — set to your Mira row id.

**Recommended:** run the dev server with `DICE_SEED=15,10,8` (or similar) so enemy turns replay predictably.

## Regression / bug repro

| File | Intent |
|------|--------|
| `bug-001-wrong-weapon-narration.json` | Weapon in narration matches attack (dagger vs default staff). |
| `bug-003-negative-tone-endturn.json` | After big hit + end turn, no despair/exhaustion tone. |
| `bug-006-action-spent-fresh-turn.json` | No "action already spent" on fresh turn / Scorching Ray path. |

## Full arcs & immersion

| File | Intent |
|------|--------|
| `combat-arc-tavern-ambush.json` | RP → combat → initiative → attack + damage → end turn. |
| `combat-arc-river-road.json` | Long RP lead-in, then mounted ambush and Fire Bolt. |
| `combat-arc-underground.json` | Dungeon atmosphere, then tight-quarters fight. |
| `combat-tension-readied.json` | Exploration + combat + readied threat + end turn. |

## Mechanical coverage

| File | Intent |
|------|--------|
| `combat-multi-exchange.json` | Hit + damage, end turn, round 2 miss (no damage roll). |
| `combat-crit-and-fumble.json` | Nat 20 spell line + nat 1 melee miss. |
| `combat-spell-and-endturn.json` | Fire Bolt + end turn, tone check. |
| `combat-attack-miss.json` | Low attack roll, miss path, end turn. |
| `combat-three-enemies.json` | Crowded fight, multiple hostiles, Fire Bolt, HP bounds. |
| `combat-priority-wounded.json` | NL target selection ("wounded one"). |
| `combat-dodge-and-move.json` | Dodge (or defensive) + end turn. |
| `combat-disengage-retreat.json` | Disengage + end turn. |
| `combat-help-mira.json` | Help toward named ally. |

## Multi-PC

| File | Intent |
|------|--------|
| `combat-dual-initiative-mira.json` | Silas then **Mira** initiative (`characterId` 27). |

## Negative / non-combat

| File | Intent |
|------|--------|
| `combat-exploration-calm.json` | Peaceful exploration — `combatTriggered` should stay false. |

## Format reference

See `SCENARIO_TEMPLATE.md` for `expectCombat`, `rolls`, `crossCheckNarratorHP`, and Tier 1 vs Tier 2 (LLM).
