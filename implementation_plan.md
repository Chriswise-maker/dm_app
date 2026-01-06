# Implementation Plan - LLM Driven Campaign Generator

## User Requirements
1.  **Campaign Generation**:
    *   Button to generate campaign via LLM (prompt or random).
    *   Use DM System Prompt from settings as a base.
    *   Generated content should be a "strong orientation" (broad strokes).
2.  **Editable/Viewable**:
    *   User can view and edit the generated campaign details.
3.  **Inverted Flow**:
    *   Current: Campaign -> Character -> Start.
    *   New: Campaign -> DM Prologue (Setting the scene) -> Character Creation ("Who are you?").
4.  **Prologue**:
    *   DM automatically starts with a longer prologue based on the generated campaign.

## Proposed Changes

### Phase 1: Architecture (Centralization & UI)
Goal: Centralize prompts in backend, update DB schema, and expose them in UI.

#### [MODIFY] [schema.ts](file:///Users/christian/Documents/DM APP/dm_app/server/drizzle/schema.ts)
- Add new columns to `user_settings` table:
    - `characterGenerationPrompt` (text, nullable)
    - `combatTurnPrompt` (text, nullable)
    - `combatNarrationPrompt` (text, nullable)
    - `combatSummaryPrompt` (text, nullable)

#### [MODIFY] [db.ts](file:///Users/christian/Documents/DM APP/dm_app/server/db.ts)
- Update `upsertUserSettings` and `getUserSettings` to handle the new columns.

#### [NEW] [prompts.ts](file:///Users/christian/Documents/DM APP/dm_app/server/prompts.ts)
Create a new file to house all system prompts. It will export functions to generate prompts based on inputs.
- `buildCampaignGenerationPrompt(input)` (uses `userSettings.campaignGenerationPrompt`)
- `buildCharacterGenerationPrompt(input)` (uses `userSettings.characterGenerationPrompt`)
- `buildDMPrompt(context, settings)` (uses `userSettings.systemPrompt`)
- `buildCombatEncounterPrompt(party, context)` (uses `userSettings.combatTurnPrompt` etc.)
- `buildSummaryPrompt(history)` (uses `userSettings.combatSummaryPrompt`)

#### [MODIFY] [routers.ts](file:///Users/christian/Documents/DM APP/dm_app/server/routers.ts)
- Update `settings.update` procedure to accept new prompt fields.
- Update `settings.get` procedure to return new prompt fields.
- Import prompt builders from `prompts.ts`.
- Replace hardcoded strings with function calls.

#### [MODIFY] [SettingsDialog.tsx](file:///Users/christian/Documents/DM APP/dm_app/client/src/components/SettingsDialog.tsx)
- Add new tabs or sections for "Prompts".
- Add text areas for:
    - Campaign Generation Prompt
    - Character Generation Prompt
    - Combat Prompts (Turn, Narration, Summary)
- Ensure these save to the backend.

#### [MODIFY] [combat-prompts.ts](file:///Users/christian/Documents/DM APP/dm_app/server/combat/combat-prompts.ts)
- Deprecate this file or merge it into `prompts.ts`.

### Phase 2: Content (Unification)
Goal: Rewrite the prompts to ensure a consistent "Chaos Weaver" narrative voice across the application.

#### [MODIFY] [prompts.ts](file:///Users/christian/Documents/DM APP/dm_app/server/prompts.ts)
- Update `buildDMPrompt` to use Chaos Weaver style (currently generic).
- Update `buildCampaignGenerationPrompt` to align with the tone.
- Update `buildCharacterGenerationPrompt` to ensure consistent formatting.
- Refine combat prompts if necessary.

## Verification Plan

### Phase 1 Verification (Architecture)
1.  **Regression Testing**: Ensure all features (Chat, Combat, Generation) still work exactly as before.

### Phase 2 Verification (Content)
1.  **Manual Review**: Check the "personality" of the responses.
2.  **Consistency Check**: Ensure the DM doesn't switch personalities between combat and narrative.

### 4. Flow Modification
*   **New Campaign Flow**:
    *   User creates campaign (with generated content).
    *   User enters campaign -> Immediate "Prologue" chat message from DM (system).
    *   User is prompted to create a character *after* or *during* this initial interaction.
    *   *Investigation needed*: How is character creation currently triggered? Is it a hard gate before entering the chat?

## Investigation Questions
1.  Where is the "DM System Prompt" stored?
2.  How is the chat initiated?
3.  How is character creation enforced?
4.  What is the current `campaign` schema?

## Next Steps
1.  Explore codebase to answer investigation questions.
2.  Refine this plan with the user.
