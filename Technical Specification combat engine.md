# **Technical Specification: Split-Brain D\&D 5e Combat Engine**

Target Agent: Cursor / Windsurf / Senior Full-Stack Agent  
Architecture: Split-Brain (Deterministic Logic \+ Probabilistic Narrative)

## **1\. Executive Summary**

We are building a combat engine for a "Dungeon Master" application. The core requirement is **Logic/Narrative Decoupling**.

* **The Logic Engine (Python):** The Source of Truth. Handles state, math, dice, and rules.  
* **The Narrative Layer (LLM):** The Interface. Parses user intent and describes outcomes based *strictly* on Logic Engine logs.

## **2\. Recommended Tech Stack & Libraries**

*Do not reinvent the wheel. Use these libraries to handle the heavy lifting.*

### **Backend (Logic Engine)**

* **Language:** Python 3.10+  
* **Framework:** FastAPI (stateless, easy to test).  
* **Dice Parsing:** d20 (Python library).  
  * *Why:* Handles complex notation (1d20+5, 2d8kh1) and provides detailed roll breakdowns for the UI.  
* **Data Validation:** Pydantic (Crucial for rigid state management).  
* **D\&D 5e Data Source:** Open5e API (or a local cache of the SRD 5.1 JSON).  
  * *Instruction:* Do not hardcode monster stats. Create a MonsterFactory class that fetches data from Open5e API and maps it to our CombatEntity schema.

### **Frontend (User Interface)**

* **Framework:** React (Vite).  
* **State Management:** React Query (for syncing with the Logic API).  
* **Dice Visuals:** react-dice-complete or three-js (for physics-based rolling).

## **3\. Data Architecture (The Source of Truth)**

### **Core Schema: BattleState**

The entire combat must be serializable into a single JSON object. This allows for easy debugging and state restoration.  
{  
  "battle\_id": "uuid",  
  "turn\_number": 1,  
  "active\_entity\_id": "goblin\_1",  
  "entities": {  
    "player\_1": { "hp": 25, "ac": 16, "initiative": 18, "position": \[0,0\] },  
    "goblin\_1": { "hp": 7, "ac": 15, "initiative": 12, "position": \[5,5\] }  
  },  
  "log\_history": \[\]  
}

### **Core Schema: ActionPayload (Input)**

The result of the LLM Intent Parser.  
{  
  "source\_id": "player\_1",  
  "action\_type": "ATTACK\_WEAPON",  
  "target\_id": "goblin\_1",  
  "params": { "weapon": "longsword", "modifier\_override": null }  
}

## **4\. Implementation Phase Plan & Feedback Loops**

### **Phase 1: The "White Box" Logic Engine (No LLM, No UI)**

**Goal:** A Python script where I can type attack(player, goblin) and see HP drop correctly.

1. **Setup:** Initialize Poetry or pip with d20, pydantic, pytest.  
2. **Entity Model:** Create class CombatEntity using Pydantic.  
3. **Dice Wrapper:** Create a service that accepts a string ("1d20+3") and returns a structured result using the d20 library.  
4. **Turn Manager:** Implement a circular linked list or index tracker for Initiative.  
5. **TESTING GATE:**  
   * Write a unit test: test\_goblin\_death(). Assert that when HP \<= 0, status becomes DEAD.  
   * *User Feedback Session:* I will run pytest. If it passes, we proceed.

### **Phase 2: The Data Layer (Open5e Integration)**

**Goal:** Stop using fake data. Fetch real monsters.

1. **API Client:** Write a Python function to query Open5e for "Goblin".  
2. **Mapper:** Write a function to convert the Open5e JSON response into our CombatEntity Pydantic model.  
3. **TESTING GATE:**  
   * Fetch an "Ancient Red Dragon". Verify that its HP and AC match the official SRD.

### **Phase 3: The API & Intent Parser (The "Split")**

**Goal:** Connect natural language to the logic.

1. **FastAPI Setup:** logical endpoints (POST /new-combat, POST /action).  
2. **LLM Parser:** Create a prompt that takes user text ("I stab it\!") and the current valid targets list, and outputs the ActionPayload JSON.  
3. **TESTING GATE (The "Human-in-the-Loop"):**  
   * **Debug Mode:** The Agent must implement a dry\_run flag.  
   * *Scenario:* User inputs "I cast Fireball."  
   * *Output:* System returns the JSON it *would* have executed. User manually approves or edits it.

### **Phase 4: Narrative Wrapping & Frontend**

**Goal:** Make it look and sound like D\&D.

1. **Narrator:** Send the Logic Engine's *structured log* ({event: hit, dmg: 5}) to the LLM with the instruction: "Describe this excitement."  
2. **UI:** React frontend that polls the BattleState.

## **5\. Debugging & Testing Protocols for the Agent**

### **The "State Replay" Rule**

* **Requirement:** Every time the Logic Engine crashes or calculates incorrectly, the agent must be able to export battle\_state.json.  
* **Agent Instruction:** "Create a load\_state(json\_file) function immediately. If I encounter a bug, I will send you the JSON, and you must add it to the test suite as a regression test."

### **Unit Testing Requirements**

* **Math Integrity:** Tests must exist for Critical Hits (doubling dice, not modifiers).  
* **Turn Order:** Tests must verify that end\_turn() correctly advances to the next entity, skipping dead ones.

## **6\. Development Workflow (Copy this to Agent)**

1. **Step 1:** Create the file structure.  
2. **Step 2:** Implement CombatEntity (Pydantic) and DiceRoller (d20 wrapper).  
3. **Step 3:** **STOP.** Ask user to review the code and run the first basic test.  
4. **Step 4:** Implement BattleManager (Initiative/Turn logic).  
5. **Step 5:** **STOP.** Ask user to review.