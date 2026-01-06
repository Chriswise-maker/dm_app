# **Technical Execution Report: Neuro-Symbolic Architecture for Autonomous D\&D 5e Dungeon Master Application**

## **1\. Architectural Philosophy: The Asynchronous Split-Brain**

The pursuit of an automated "Dungeon Master" (DM) capable of facilitating Dungeons & Dragons 5th Edition (5e) represents a convergence of two distinct computational disciplines: creative generation and rigorous simulation. The fundamental challenge lies in the discordant nature of these domains. Large Language Models (LLMs) are probabilistic engines prone to "hallucination"—a fatal flaw when managing the strict accounting of hit points (HP) and spell slots.1 Conversely, traditional game engines are deterministic but lack the interpretive flexibility to handle the infinite agency inherent in TTRPGs.  
To bridge this divide, this report proposes a **Split-Brain Neuro-Symbolic Architecture** that decouples the **Narrative Layer** (neural, probabilistic) from the **Simulation Layer** (symbolic, deterministic). Furthermore, to accommodate the requirement for **Visual Dice Rolling**, the architecture must shift from a purely synchronous calculation loop to an **Asynchronous Request-Response Pattern**, allowing the engine to pause and await user verification (the die roll) before proceeding.

### **1.1 Architectural Components and Data Flow**

| Component | Responsibility | Technology Stack |
| :---- | :---- | :---- |
| **Narrative Layer** | Intent Parsing, Context Rendering, Flavor Text Generation | LLM (GPT-4/Claude), Context Engineering |
| **Bridge Layer** | API Schema, JSON Validation, structured Output Parsing | Pydantic, JSON Schema, Function Calling |
| **Simulation Layer** | Rule Execution, State Management, Validations | Python (FastAPI/Flask), Event Bus, ECS |
| **Visual/UI Layer** | 3D Dice Rendering, Grid Visualization, User Input | React/Three.js (react-3d-dice, dice-box) |
| **Data Layer** | Static Rules Source, Monster/Spell Stats | Open5e API, JSON SRD Repositories |

The operational cycle is a unidirectional loop of state mutation with a specific **"Yield for RNG"** interrupt:

1. **Intent:** User says "I swing my sword." \-\> LLM parses to Action: Attack.  
2. **Validation:** Engine checks range and resource availability.  
3. **Yield:** Engine determines a roll is needed (1d20 \+ 5). It pauses the logic and sends a RollRequest to the UI.  
4. **Visual Interaction:** The UI displays 3D dice. The user (or physics engine) rolls. Result: 14\.  
5. **Resume:** The UI sends Result: 14 back to the Engine.  
6. **Resolution:** Engine calculates 14 \+ 5 \= 19, compares to AC, and applies damage.

## **2\. Mechanics Deconstruction: The Physics of the D\&D World**

To build a deterministic engine, we view D\&D 5e strictly as a physics engine governed by discrete mathematics and resource management.

### **2.1 The "Human-in-the-Loop" RNG Logic**

Standard video games resolve RNG (Random Number Generation) instantly in the backend. To support a "Visual Die Simulator," the engine must treat dice rolls not as calculations, but as **External Inputs**.

* **The Roll Request State:** When the engine encounters a probabilistic check (Attack Roll, Saving Throw), it does not call random.randint(). Instead, it enters a AWAIT\_ROLL state and returns a payload to the frontend:  
  JSON  
  {  
    "status": "AWAIT\_ROLL",  
    "roll\_id": "atk\_player1\_goblin2",  
    "dice\_formula": "1d20",  
    "modifier": 5,  
    "reason": "Attack Roll vs Goblin"  
  }

* **The UI Resolver:** The frontend receives this, spawns a 3D die using a library like **dice-box** (BabylonJS) or **react-dice-roll**, and waits for the physics to settle. The result is then posted back to the engine to resume the turn.

### **2.2 The Action Economy as Resource Constraints**

We model actions as expenditures of specific resource tokens.

| Resource Type | Reset Trigger | Engine Representation |
| :---- | :---- | :---- |
| **Action** | Start of Turn | actor.resources.action \= 1 |
| **Bonus Action** | Start of Turn | actor.resources.bonus\_action \= 1 |
| **Reaction** | Start of Turn | actor.resources.reaction \= 1 |
| **Movement** | Start of Turn | actor.resources.movement \= actor.speed |

### **2.3 The Initiative Stack**

The engine enforces a strict, reproducible hierarchy for sorting the **Turn Order**:

1. **Initiative Roll** (descending).  
2. **Dexterity Modifier** (descending).  
3. **Dexterity Score** (descending).  
4. **Deterministic Random Seed** (generated at encounter initialization).

## **3\. Data Architecture and Sourcing**

The Coding Agent cannot "read" a book. It requires structured JSON data to populate the CombatEntity objects.

### **3.1 Data Sourcing Strategy (Source of Truth)**

The system will ingest data from established Open Game License (OGL) API sources and repositories.

1. **5e API (Open5e):** A robust, open-source API that provides JSON data for Monsters, Spells, and Sections of the SRD.  
   * *Usage:* The Agent will query https://api.open5e.com/monsters/?challenge\_rating=1 to fetch valid enemy stats dynamically.  
2. **Static JSON Repositories:** For core rules that don't change (like Weapons tables or XP thresholds), use raw JSON dumps from repositories like 5e-bits or dnd-5e-srd.  
   * *Usage:* Load weapons.json into memory at startup to validate damage dice (e.g., "Longsword" \= "1d8 slashing").

### **3.2 The Global Battle State Object**

The BattleState is the single source of truth.

JSON

{  
  "battle\_id": "uuid-v4",  
  "phase": "await\_roll",  
  "active\_roll\_request": {  
     "source": "player\_1",  
     "dice": "1d20",  
     "callback\_id": "resolve\_attack\_step\_2"  
  },  
  "entities": {  
    "player\_01": { "$ref": "\#/definitions/entity" },  
    "goblin\_01": { "$ref": "\#/definitions/entity" }  
  },  
  "grid": {... }  
}

## **4\. The Logic Flow (The Algorithm)**

The execution of a turn follows a strict **Finite State Machine (FSM)**.

1. **Turn Initialization:** Reset resources (Action, Bonus, Movement). Process StartOfTurn effects (e.g., taking poison damage).  
2. **Input Phase (State: AWAIT\_INPUT):**  
   * Engine sends Context to LLM.  
   * LLM parses user text ("I hit him with my axe") into JSON: {"action": "Attack", "target": "Goblin\_A"}.  
3. **Validation Phase:**  
   * Engine checks: Has Action? Yes. Target in range? Yes. Weapon equipped? Yes.  
4. **RNG Phase (State: AWAIT\_ROLL):**  
   * **STOP:** Engine pauses. Sends RollRequest(1d20+5) to UI.  
   * **RESUME:** UI sends Result(18).  
5. **Resolution Phase:**  
   * Engine calculates: 18 (roll) \+ 5 (mod) \= 23\.  
   * Check vs Target AC (12). Result: **Hit**.  
   * **STOP:** Engine pauses. Sends RollRequest(1d8+3) for damage.  
   * **RESUME:** UI sends Result(7).  
   * Engine applies 7 damage to Goblin.  
6. **State Update:** Goblin HP 7 \-\> 0\. Status: Dead.  
7. **Narrative Output:** Engine sends result to LLM to describe the kill.

## **5\. Implementation Roadmap (Step-by-Step)**

This roadmap is designed for an autonomous coding agent. It prioritizes the "Walking Skeleton" approach—getting the logic working before adding AI or graphics.

### **Phase 1: The "Walking Skeleton" (Core Logic Only)**

*Goal: A text-based script that plays a combat turn using manual inputs.*

* **Step 1.1:** Define Pydantic models for Entity (HP, AC, Stats) and Weapon.3  
* **Step 1.2:** Ingest Static Data. Write a script to load monsters.json from Open5e/SRD and instantiate an Entity object (e.g., a Goblin) from it.  
* **Step 1.3:** Build the TurnManager. A simple loop that iterates through a list of entities sorted by Initiative.  
* **Step 1.4:** Implement AttackAction. Hardcode the math: if roll \+ mod \>= ac: hp \-= damage.  
* **Deliverable:** A Python script where you run battle.next\_turn() and it prints the outcome to the console.

### **Phase 2: The Data & API Layer (The Brain)**

*Goal: Expose the logic via an API so a frontend can talk to it.*

* **Step 2.1:** Wrap Phase 1 logic in a **FastAPI** or **Flask** application.  
* **Step 2.2:** Create the POST /action endpoint that accepts JSON commands.  
* **Step 2.3:** Implement the **State Machine** for Pausing. If an attack is declared, return a 200 OK with status: "ROLL\_REQUIRED".  
* **Step 2.4:** Create the POST /roll\_result endpoint. This receives the number from the UI and resumes the calculation.  
* **Deliverable:** You can use Postman/Curl to send "Attack", get a response asking for a roll, send the roll, and get the damage result.

### **Phase 3: The Visuals (The Eyes & Hands)**

*Goal: Browser-based UI with 3D dice.*

* **Step 3.1:** Set up a React frontend.  
* **Step 3.2:** Integrate a 3D Dice library (e.g., react-3d-dice or dice-box).  
* **Step 3.3:** Connect UI to API. When API returns ROLL\_REQUIRED, trigger the 3D dice animation.  
* **Step 3.4:** On animation complete, capture the value and POST it back to the API.  
* **Deliverable:** A web page where you click "Attack," dice roll on screen, and the health bar updates.

### **Phase 4: The Neuro-Symbolic Bridge (The Voice)**

*Goal: Connect the LLM for natural language.*

* **Step 4.1:** Implement **Context Rendering**. Convert the JSON state ("Goblin HP: 0") into a text prompt ("The goblin is dead").  
* **Step 4.2:** Set up the LLM (OpenAI/Claude) with **Function Calling**. Define the attack\_enemy tool so the LLM outputs structured JSON instead of text.4  
* **Step 4.3:** Build the Narrative Wrapper. Pass the final engine result back to the LLM to generate a description ("You sever the goblin's head\!").  
* **Deliverable:** You type "I kill the goblin," the dice roll, and the text replies "The goblin falls."

### **Phase 5: Advanced Mechanics (The Polish)**

*Goal: Add the complex rules.*

* **Step 5.1:** **Grid & Pathfinding.** Add (x,y) coordinates to Entities. Use an A\* algorithm library (pathfinding) to validate movement distance.  
* **Step 5.2:** **Reactions/Interrupts.** Implement a LIFO stack for *Shield* spells or Opportunity Attacks.  
* **Step 5.3:** **Conditions.** Add logic for "Poisoned" (Disadvantage on rolls) or "Paralyzed" (Auto-crit).

## **6\. Conclusion**

By shifting the Simulation Layer to an **Asynchronous Request-Response** model, we allow for the "Visual Dice Simulator" requirement while maintaining a secure, authoritative server state. The Coding Agent will utilize **Open5e** and **SRD JSONs** as its reference library, ensuring it does not need to "learn" D\&D from scratch but rather imports the rules as data. The phased roadmap ensures a stable foundation before introducing the complexity of AI and 3D graphics.

#### **Referenzen**

1. LLMs as a GM | EN World D\&D & Tabletop RPG News & Reviews, Zugriff am Januar 3, 2026, [https://www.enworld.org/threads/llms-as-a-gm.714126/](https://www.enworld.org/threads/llms-as-a-gm.714126/)  
2. How I Built an LLM-Based Game from Scratch | Towards Data Science, Zugriff am Januar 3, 2026, [https://towardsdatascience.com/how-i-built-an-llm-based-game-from-scratch-86ac55ec7a10/](https://towardsdatascience.com/how-i-built-an-llm-based-game-from-scratch-86ac55ec7a10/)  
3. dnd-character \- PyPI, Zugriff am Januar 3, 2026, [https://pypi.org/project/dnd-character/](https://pypi.org/project/dnd-character/)  
4. Introducing Structured Outputs in the API \- OpenAI, Zugriff am Januar 3, 2026, [https://openai.com/index/introducing-structured-outputs-in-the-api/](https://openai.com/index/introducing-structured-outputs-in-the-api/)