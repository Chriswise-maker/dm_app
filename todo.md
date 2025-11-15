# D&D Dungeon Master Chat Application - TODO

## Database & Schema
- [x] Create sessions table (campaign tracking)
- [x] Create characters table (with stats, inventory, HP, AC)
- [x] Create messages table (chat history)

## Backend Features
- [x] Database helper functions (create/read/update operations)
- [x] Session management procedures (create, list, get)
- [x] Character management procedures (create, update, list, get)
- [x] Message history procedures (save, retrieve)
- [x] LLM integration with context enrichment
- [x] Streaming DM responses
- [x] Automatic campaign summarization (every 20 messages)
- [x] HP update functionality
- [ ] Model selection support (Claude/GPT switching) - optional enhancement

## Frontend Features
- [x] Session Manager component (create/switch sessions)
- [x] Character Panel component (list, select, HP tracking)
- [x] Character creation form UI
- [x] Chat Interface with message history
- [x] Streaming message display
- [x] Loading states for DM responses
- [x] Error handling and user-friendly messages
- [x] Inventory management UI
- [x] Stats display (STR, DEX, CON, INT, WIS, CHA)
- [x] Message history persistence (reload on refresh)
- [x] TypeScript types for all API responses

## API Integration
- [x] LLM integration using built-in Manus API (no user API key needed)
- [ ] Model selection dropdown - optional enhancement
- [ ] LLM provider switching (Claude/GPT) - optional enhancement

## Testing & Polish
- [x] Test session creation and switching
- [x] Test character creation and management
- [x] Test chat functionality with LLM
- [x] Test HP tracking
- [x] Test message persistence
- [x] Error boundary testing
- [x] Responsive design verification

## Optional Enhancements (Not Required)
- [ ] Export/Import campaign data
- [ ] Combat mode with initiative tracking
- [ ] Custom model selection UI
- [ ] Voice input for messages
- [ ] Image generation for scenes

## Settings & Configuration (New Feature)
- [x] Settings database table for user preferences
- [x] LLM provider selection (OpenAI, Anthropic, Google, Manus Built-in)
- [x] API key storage (encrypted)
- [x] Model selection dropdown per provider
- [x] Settings UI component with tabs
- [x] Backend procedures for saving/loading settings
- [x] Update LLM integration to use user settings
- [x] Text-to-speech configuration (prepare for future integration)
- [x] Default settings fallback to Manus built-in

## Model Updates
- [x] Add Claude Sonnet 4.5 to Anthropic model options
- [x] Add GPT-5 to OpenAI model options

## System Prompt Customization
- [x] Add systemPrompt field to settings database table
- [x] Add backend procedures to save/load system prompt
- [x] Create system prompt editor UI in settings (new tab)
- [x] Add default DM system prompt with personality and rules
- [x] Update LLM integration to use custom system prompt
- [x] Add reset to default button
- [x] Add character count and helpful tips

## Streaming Responses
- [x] Update backend LLM integration to support streaming (client-side streaming effect)
- [x] Create streaming endpoint/mutation in tRPC (using regular mutation with client-side display)
- [x] Update ChatInterface to display streaming text in real-time
- [x] Add loading indicator while streaming starts
- [x] Handle streaming errors gracefully
- [x] Ensure message persistence after streaming completes

## Loading Indicator & Standalone Mode
- [x] Add "DM is thinking..." animated indicator while waiting for responses
- [x] Add animated dots to thinking indicator
- [x] Make LLM integration work with direct API calls (no Manus dependency)
- [x] Update settings to allow using custom API keys directly
- [x] Standalone mode ready (supports OpenAI, Anthropic, Google with custom keys)
- [x] App can run independently with user-provided API keys

## UX Improvements
- [x] Display player message immediately when sent (don't wait for LLM response)
- [x] Implement smart auto-scroll (only scroll if user is already at bottom)
- [x] Prevent forced scrolling when user is reading previous messages

## Auto-Scroll Fix
- [x] Fix auto-scroll to truly respect user position during streaming
- [x] Add scroll position detection during streaming effect
- [x] Only auto-scroll if user is within 100px of bottom

## Intelligent Context Management System
- [x] Design extensible JSON schema for campaign context
- [x] Add context table to database (session-level storage)
- [x] Implement automatic context extraction after each DM response
- [x] Extract character state updates (HP, inventory, conditions)
- [x] Extract NPCs (names, descriptions, disposition)
- [x] Extract locations visited
- [x] Extract plot points and quests
- [x] Extract items acquired/lost
- [x] Update LLM integration to use smart context (last 10 messages + summary)
- [x] Reduce token usage by not sending full message history
- [x] Add extensible fields for future additions (relationships, factions, etc.)
- [ ] Create context viewer UI (optional, for debugging)

## Future Context Extensions (Prepared Schema)
- [ ] Character relationships and affinity scores
- [ ] NPC disposition tracking
- [ ] Faction standings
- [ ] Quest progress tracking
- [ ] World state changes

## Bug Fixes - Auto-Scroll & Context Sync
- [x] Test auto-scroll behavior during streaming to identify issue
- [x] Fix auto-scroll to truly prevent forced scrolling when user scrolls up
- [x] Test character HP auto-update after combat narrative
- [x] Test inventory auto-update after acquiring/losing items
- [x] Debug context extraction to ensure it's actually running
- [x] Verify extracted context is being saved to database
- [x] Verify character updates are being applied from extracted context

## Known Limitations
- Context extraction LLM accuracy: The extraction sometimes misreads HP values from narrative text (e.g., DM says "10/28 HP" but extraction returns "5"). This is an LLM accuracy issue that could be improved with better prompts or a more capable model.
