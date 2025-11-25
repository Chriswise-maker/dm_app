import { extractContextFromResponse } from './server/context-extraction';
import dotenv from 'dotenv';

dotenv.config();

async function testExtraction() {
    console.log('Testing Combat Extraction with Name Mapping...');

    const scenarios = [
        {
            player: "I slash the Brute with my longsword! 8 damage!",
            dm: "Your blade cuts deep into the Dragon Brute's shoulder. He howls in pain. (8 damage taken)",
            char: "Eldrin",
            validNames: ["Dragon-Touched Revolutionary 1", "Dragon-Touched Leader"]
        }
    ];

    for (const s of scenarios) {
        console.log('\n--- Scenario ---');
        console.log('Player:', s.player);
        console.log('DM:', s.dm);
        console.log('Valid Names:', s.validNames);

        try {
            const result = await extractContextFromResponse(s.dm, s.player, s.char, s.validNames);
            console.log('Extracted:', JSON.stringify(result.combatUpdates, null, 2));
        } catch (e) {
            console.error('Error:', e);
        }
    }
}

testExtraction();
