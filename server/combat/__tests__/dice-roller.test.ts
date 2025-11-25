import { DiceRoller } from '../dice-roller';

/**
 * Simple test suite for dice roller
 * Run with: node --loader tsx server/combat/__tests__/dice-roller.test.ts
 */

function testDiceRoller() {
    console.log('🎲 Testing Dice Roller...\n');

    // Test 1: Roll d20
    console.log('Test 1: Roll d20');
    for (let i = 0; i < 5; i++) {
        const roll = DiceRoller.rollD20();
        console.log(`  Roll ${i + 1}: ${roll} (valid: ${roll >= 1 && roll <= 20})`);
    }

    // Test 2: Parse and roll "2d6+3"
    console.log('\nTest 2: Roll "2d6+3"');
    for (let i = 0; i < 5; i++) {
        const roll = DiceRoller.roll('2d6+3');
        console.log(`  Roll ${i + 1}: ${roll} (valid: ${roll >= 5 && roll <= 15})`);
    }

    // Test 3: Parse and roll "1d8+3"
    console.log('\nTest 3: Roll "1d8+3"');
    for (let i = 0; i < 5; i++) {
        const roll = DiceRoller.roll('1d8+3');
        console.log(`  Roll ${i + 1}: ${roll} (valid: ${roll >= 4 && roll <= 11})`);
    }

    // Test 4: Parse "d20" (implicit 1d20)
    console.log('\nTest 4: Roll "d20"');
    const roll = DiceRoller.roll('d20');
    console.log(`  Roll: ${roll} (valid: ${roll >= 1 && roll <= 20})`);

    // Test 5: Negative modifier "1d6-1"
    console.log('\nTest 5: Roll "1d6-1"');
    for (let i = 0; i < 5; i++) {
        const roll = DiceRoller.roll('1d6-1');
        console.log(`  Roll ${i + 1}: ${roll} (valid: ${roll >= 0 && roll <= 5})`);
    }

    // Test 6: Advantage
    console.log('\nTest 6: Roll with advantage "d20"');
    for (let i = 0; i < 3; i++) {
        const roll = DiceRoller.rollWithAdvantage('d20');
        console.log(`  Roll ${i + 1}: ${roll}`);
    }

    // Test 7: Disadvantage
    console.log('\nTest 7: Roll with disadvantage "d20"');
    for (let i = 0; i < 3; i++) {
        const roll = DiceRoller.rollWithDisadvantage('d20');
        console.log(`  Roll ${i + 1}: ${roll}`);
    }

    // Test 8: Invalid formula
    console.log('\nTest 8: Invalid formula (should throw error)');
    try {
        DiceRoller.roll('invalid');
        console.log('  ❌ Should have thrown error!');
    } catch (e: any) {
        console.log(`  ✅ Correctly threw error: ${e.message}`);
    }

    console.log('\n✅ All dice roller tests completed!');
}

testDiceRoller();
