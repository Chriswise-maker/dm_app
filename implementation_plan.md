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

### 1. Database Schema Updates
*   We likely need a field to store the "Campaign Description" or "World State" on the `campaigns` table.
*   Maybe a `prologue` field if we want to cache the initial message.

### 2. UI/UX Updates
*   **Campaign Creation Modal/Page**:
    *   Add "Generate Campaign" button.
    *   Add "Prompt" input (optional).
    *   Add Textarea for the generated campaign description (editable).
*   **Campaign View**:
    *   Ensure the description is visible/editable in the campaign settings or dashboard.

### 3. Backend / API
*   **Generation Endpoint**:
    *   New API route (e.g., `/api/ai/generate-campaign`) that calls the LLM.
    *   Inputs: User prompt, DM System Prompt (from settings).
    *   Output: Campaign Title, Description/Premise, Initial Prologue.
*   **Campaign Creation**:
    *   Save the generated description and prologue when creating the campaign.

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
