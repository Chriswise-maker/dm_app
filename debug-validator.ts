
import { validateDiceRoll } from "./server/combat/combat-validators";

console.log("Testing 1d4, roll 6:");
console.log(validateDiceRoll(6, "1d4"));

console.log("Testing 1d4, roll 2:");
console.log(validateDiceRoll(2, "1d4"));

console.log("Testing 1d20+5, roll 30:");
console.log(validateDiceRoll(30, "1d20+5"));

console.log("Testing 1d20+5, roll 25:");
console.log(validateDiceRoll(25, "1d20+5"));
