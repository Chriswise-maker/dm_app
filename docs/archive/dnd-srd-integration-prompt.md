# Task: Integrate D&D 5e SRD Data as a Local Game Mechanics Layer

## Context

This is a chat-based D&D app where an LLM (via API) acts as the Dungeon Master. The LLM DM needs access to the full D&D 5e rule system — classes, races, spells, monsters, equipment, etc. — to run a pen & paper style adventure. We don't need 100% rules-as-written fidelity, but the system should *feel* like D&D: balanced, rich, and mechanically coherent.

## Data Source

Clone or download the JSON data from: **https://github.com/5e-bits/5e-database**

The repo contains the entire D&D 5e SRD (Systems Reference Document) as structured JSON files under `src/`. It's MIT-licensed and CC-BY-4.0 for the game content. The data covers:

- **Classes** (with subclasses and full level progression)
- **Races and Subraces**
- **Spells** (300+ spells with all metadata: level, school, components, damage, scaling)
- **Monsters** (300+ creatures with full stat blocks, actions, legendary actions)
- **Equipment** (weapons, armor, adventuring gear, tools)
- **Magic Items**
- **Ability Scores, Skills, Proficiencies**
- **Conditions** (poisoned, stunned, etc.)
- **Damage Types**
- **Feats, Features, Traits**
- **Rules and Rule Sections**
- **Alignments, Languages**

## What to Build

### 1. Data Ingestion

- Pull all JSON files from the `5e-database` repo's `src/` directory
- Store them locally in the project (e.g., `data/srd/` or similar, follow existing project conventions)
- Keep the original category structure (spells, monsters, classes, etc.) — don't flatten everything into one blob
- No database needed — JSON files on disk are fine, loaded into memory at startup or queried from disk as needed

### 2. Lookup / Query Layer

Build a lightweight service or module that can:

- **Look up by name** (fuzzy/partial match): "find the spell Fireball", "look up Goblin stats"
- **Look up by index/slug**: the 5e-database uses kebab-case index keys like `fireball`, `goblin`, `fighter`
- **Filter by category**: "all 3rd-level Wizard spells", "all monsters CR 5 or below", "all martial weapons"
- **Return full structured data** for a given entity (the complete JSON object)

This layer should be callable by the DM logic — i.e., when the LLM needs to reference game mechanics, it (or the surrounding app code) can query this layer and inject the relevant data into the LLM context.

### 3. Integration with the LLM DM

The key design question: how does the DM "use" this data? Implement this pattern:

- **Tool/function calling**: Define tools the LLM can invoke during its DM turn, such as:
  - `lookup_spell(name)` → returns spell data
  - `lookup_monster(name)` → returns monster stat block  
  - `lookup_class(name, level?)` → returns class info, optionally at a specific level
  - `lookup_equipment(name)` → returns item data
  - `lookup_rule(topic)` → returns relevant rule text
  - `search_srd(query, category?)` → general search across all categories
- When the LLM calls one of these tools, resolve it against the local JSON data and return the result as tool output
- The LLM then uses that data to make rulings, describe combat outcomes, manage character progression, etc.

**Important**: Keep the tool responses concise. Don't dump an entire monster stat block with 50 fields if the DM just needs AC and HP for a quick attack resolution. Consider returning a summary by default with an option to get full details.

### 4. System Prompt Context

Include a compact reference sheet in the DM's system prompt that covers:

- List of available SRD tool functions and when to use them
- Core mechanic summary (d20 + modifier vs DC/AC, advantage/disadvantage, saving throws)  
- Brief list of available classes, races, and spell levels so the DM knows what exists without needing to query for everything
- Character sheet structure (what stats a PC has, how HP/AC/spells work)

Do NOT put the full SRD data in the system prompt — that's what the tools are for.

## Constraints & Preferences

- Follow existing project patterns for file structure, module style, and error handling
- No external API dependency at runtime — everything works offline from the local JSON
- Keep it simple: no database, no ORM, no over-engineering. JSON files + in-memory lookup is fine
- If the existing app has a tool/function calling setup, integrate with that. If not, build one
- The data doesn't need to update dynamically — the SRD is static content. A manual refresh from the repo is fine for updates

## Out of Scope (for now)

- Character sheet persistence / state management (separate concern)
- Dice rolling engine (separate concern, unless it doesn't exist yet — then add a basic one)
- Combat tracker / initiative system (separate concern)
- Map/grid visualization

## Getting Started

1. Clone/download the 5e-database JSON data into the project
2. Explore the data structure — look at a few files in each category to understand the schema
3. Build the lookup layer
4. Define the LLM tool functions
5. Wire tools into the existing DM chat flow
6. Add the compact reference to the system prompt
7. Test with a few scenarios: "I cast Fireball at the goblins", "What's my Fighter's Extra Attack at level 5?", "I want to buy a longsword"
