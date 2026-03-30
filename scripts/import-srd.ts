/**
 * SRD Data Import Script
 *
 * Reads raw 5e-database JSON files and writes normalized JSON to data/srd-2014/.
 * Run: npx tsx scripts/import-srd.ts
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const RAW_DIR = join(process.cwd(), "data/raw/5e-database/src/2014");
const OUT_DIR = join(process.cwd(), "data/srd-2014");

function readRaw(filename: string) {
  return JSON.parse(readFileSync(join(RAW_DIR, filename), "utf-8"));
}

function writeOut(filename: string, data: unknown) {
  writeFileSync(join(OUT_DIR, filename), JSON.stringify(data, null, 2) + "\n");
  console.log(`  ✓ ${filename}: ${Array.isArray(data) ? data.length + " entries" : "written"}`);
}

// ---------- SPELLS ----------

function parseSpeed(ft: string): number | undefined {
  const m = ft.match(/(\d+)/);
  return m ? parseInt(m[1]) : undefined;
}

function normalizeCastingTime(raw: string): string {
  if (raw === "1 action") return "action";
  if (raw === "1 bonus action") return "bonus_action";
  if (raw === "1 reaction") return "reaction";
  return raw;
}

function normalizeSaveEffect(dcSuccess: string | undefined): string | undefined {
  if (!dcSuccess) return undefined;
  if (dcSuccess === "half") return "half_damage";
  if (dcSuccess === "none") return "no_effect";
  return "special";
}

function normalizeSpells() {
  const raw = readRaw("5e-SRD-Spells.json");
  return raw.map((s: any) => {
    const baseLevel = s.level;
    const damageData = s.damage;
    const slotLevels = damageData?.damage_at_slot_level;
    const damageFormula = slotLevels ? slotLevels[String(baseLevel)] || Object.values(slotLevels)[0] : undefined;
    const damageType = damageData?.damage_type?.index;

    const healData = s.heal_at_slot_level;
    let healingFormula: string | undefined;
    if (healData) {
      const baseHeal = healData[String(baseLevel)] || Object.values(healData)[0];
      // Strip " + MOD" from heal formulas
      healingFormula = typeof baseHeal === "string" ? baseHeal.replace(/\s*\+\s*MOD/, "") : undefined;
    }

    const aoe = s.area_of_effect;
    const isAreaEffect = !!aoe;
    const areaSize = aoe ? `${aoe.size}-foot ${aoe.type}` : undefined;

    const result: any = {
      name: s.name,
      level: s.level,
      school: s.school.index,
      castingTime: normalizeCastingTime(s.casting_time),
      range: s.range,
      components: s.components,
      ...(s.material && { material: s.material }),
      duration: s.duration,
      requiresConcentration: s.concentration,
      ritual: s.ritual,
      description: s.desc.join("\n"),
      ...(damageFormula && { damageFormula }),
      ...(damageType && { damageType }),
      ...(healingFormula && { healingFormula }),
      ...(s.dc && { saveStat: s.dc.dc_type.index }),
      ...(s.dc && { saveEffect: normalizeSaveEffect(s.dc.dc_success) }),
      isAreaEffect,
      ...(areaSize && { areaSize }),
      classes: s.classes.map((c: any) => c.index),
      ...(s.higher_level?.length && { higherLevels: s.higher_level.join("\n") }),
    };
    return result;
  });
}

// ---------- MONSTERS ----------

const CR_XP: Record<number, number> = {
  0: 10, 0.125: 25, 0.25: 50, 0.5: 100, 1: 200, 2: 450, 3: 700, 4: 1100,
  5: 1800, 6: 2300, 7: 2900, 8: 3900, 9: 5000, 10: 5900, 11: 7200, 12: 8400,
  13: 10000, 14: 11500, 15: 13000, 16: 15000, 17: 18000, 18: 20000, 19: 22000,
  20: 25000, 21: 33000, 22: 41000, 23: 50000, 24: 62000, 25: 75000, 26: 90000,
  27: 105000, 28: 120000, 29: 135000, 30: 155000,
};

function normalizeMonsters() {
  const raw = readRaw("5e-SRD-Monsters.json");
  return raw.map((m: any) => {
    const ac = m.armor_class[0];
    const acSource = ac.armor?.map((a: any) => a.name.toLowerCase()).join(", ") ||
      (ac.type !== "natural" && ac.type !== "dex" ? ac.type : undefined);

    const speeds: any = {};
    for (const [key, val] of Object.entries(m.speed)) {
      if (typeof val === "string") {
        const n = parseSpeed(val);
        if (n) speeds[key] = n;
      }
    }

    const saveProficiencies: string[] = [];
    const skillProficiencies: Record<string, number> = {};
    for (const p of m.proficiencies || []) {
      const idx = p.proficiency.index;
      if (idx.startsWith("saving-throw-")) {
        saveProficiencies.push(idx.replace("saving-throw-", ""));
      } else if (idx.startsWith("skill-")) {
        skillProficiencies[idx.replace("skill-", "")] = p.value;
      }
    }

    const senses: Record<string, number | string> = {};
    for (const [key, val] of Object.entries(m.senses)) {
      if (key === "passive_perception") {
        senses.passive_perception = val as number;
      } else {
        senses[key] = val as string;
      }
    }

    function normalizeAction(a: any) {
      const result: any = { name: a.name, description: a.desc };
      if (a.attack_bonus != null) result.attackBonus = a.attack_bonus;
      if (a.damage?.length) {
        result.damageFormula = a.damage[0].damage_dice;
        if (a.damage[0].damage_type?.index) {
          result.damageType = a.damage[0].damage_type.index;
        }
      }
      return result;
    }

    const result: any = {
      name: m.name,
      size: m.size,
      type: m.type,
      alignment: m.alignment,
      ac: ac.value,
      ...(acSource && { acSource }),
      hp: m.hit_points,
      hitDie: m.hit_dice,
      speeds,
      abilityScores: {
        str: m.strength, dex: m.dexterity, con: m.constitution,
        int: m.intelligence, wis: m.wisdom, cha: m.charisma,
      },
      ...(saveProficiencies.length && { saveProficiencies }),
      ...(Object.keys(skillProficiencies).length && { skillProficiencies }),
      ...(m.damage_resistances?.length && { damageResistances: m.damage_resistances }),
      ...(m.damage_immunities?.length && { damageImmunities: m.damage_immunities }),
      ...(m.condition_immunities?.length && {
        conditionImmunities: m.condition_immunities.map((c: any) => c.index || c.name || c),
      }),
      senses,
      languages: m.languages ? m.languages.split(", ").filter(Boolean) : [],
      cr: m.challenge_rating,
      xp: m.xp ?? CR_XP[m.challenge_rating] ?? 0,
      ...(m.special_abilities?.length && {
        traits: m.special_abilities.map((t: any) => ({ name: t.name, description: t.desc })),
      }),
      actions: (m.actions || []).map(normalizeAction),
      ...(m.legendary_actions?.length && {
        legendaryActions: m.legendary_actions.map((a: any) => ({ name: a.name, description: a.desc })),
      }),
      ...(m.reactions?.length && {
        reactions: m.reactions.map((r: any) => ({ name: r.name, description: r.desc })),
      }),
    };
    return result;
  });
}

// ---------- EQUIPMENT ----------

function normalizeEquipment() {
  const raw = readRaw("5e-SRD-Equipment.json");
  return raw.map((e: any) => {
    const catIndex = e.equipment_category?.index;
    let category: string;
    let subcategory: string | undefined;

    if (catIndex === "weapon") {
      category = "weapon";
      const range = (e.weapon_range || "").toLowerCase();
      const cat = (e.weapon_category || "").toLowerCase();
      subcategory = `${cat}_${range}`.replace(/ /g, "_");
    } else if (catIndex === "armor") {
      category = "armor";
      const armorCat = (e.armor_category || "").toLowerCase().replace(/ /g, "_");
      subcategory = `${armorCat}_armor`;
      if (armorCat === "shield") subcategory = "shield";
    } else if (catIndex === "tools") {
      category = "tool";
      subcategory = e.tool_category?.toLowerCase().replace(/ /g, "_").replace("'", "");
    } else {
      category = "adventuring_gear";
      subcategory = e.gear_category?.index?.replace(/-/g, "_");
    }

    const result: any = {
      name: e.name,
      category,
      ...(subcategory && { subcategory }),
      cost: { amount: e.cost?.quantity ?? 0, unit: e.cost?.unit ?? "gp" },
      ...(e.weight != null && { weight: e.weight }),
    };

    // Weapon fields
    if (catIndex === "weapon") {
      if (e.damage) {
        result.damage = {
          formula: e.damage.damage_dice,
          type: e.damage.damage_type?.index,
        };
      }
      if (e.properties?.length) {
        result.properties = e.properties.map((p: any) => p.index);
      }
      if (e.two_handed_damage) {
        result.versatileDamage = e.two_handed_damage.damage_dice;
      }
      if (e.range && (e.range.long || e.weapon_range === "Ranged")) {
        result.range = { normal: e.range.normal, long: e.range.long || e.range.normal };
      }
    }

    // Armor fields
    if (catIndex === "armor") {
      if (e.armor_class) {
        result.acBase = e.armor_class.base;
        result.addDexMod = e.armor_class.dex_bonus ?? false;
        if (e.armor_class.max_bonus != null) {
          result.maxDexBonus = e.armor_class.max_bonus;
        }
      }
      if (e.str_minimum) result.strengthReq = e.str_minimum;
      if (e.stealth_disadvantage) result.stealthDisadvantage = true;
    }

    return result;
  });
}

// ---------- CLASSES ----------

function normalizeClasses() {
  const rawClasses = readRaw("5e-SRD-Classes.json");
  const rawLevels = readRaw("5e-SRD-Levels.json");
  const rawFeatures = readRaw("5e-SRD-Features.json");

  return rawClasses.map((c: any) => {
    const classIndex = c.index;

    // Save proficiencies
    const saveProficiencies = (c.saving_throws || []).map((s: any) => s.index);

    // Skill choices
    const skillChoice = c.proficiency_choices?.find((pc: any) =>
      pc.from?.options?.some((o: any) => o.item?.index?.startsWith("skill-") || o.option_type === "reference" && o.item?.index?.startsWith("skill-"))
    );
    const skillChoices = skillChoice?.from?.options
      ?.map((o: any) => (o.item?.index || "").replace("skill-", ""))
      .filter(Boolean) || [];
    const skillCount = skillChoice?.choose || 0;

    // Weapon/armor proficiencies
    const weaponProficiencies: string[] = [];
    const armorProficiencies: string[] = [];
    for (const p of c.proficiencies || []) {
      const idx = p.index;
      if (idx.startsWith("saving-throw-")) continue;
      // Categorize: armor-related vs weapon-related
      if (["light-armor", "medium-armor", "heavy-armor", "shields", "all-armor"].some(a => idx.includes(a))) {
        armorProficiencies.push(p.name);
      } else {
        weaponProficiencies.push(p.name);
      }
    }

    // Spellcasting
    let spellcasting: any = undefined;
    if (c.spellcasting) {
      const ability = c.spellcasting.spellcasting_ability.index;
      const classLevels = rawLevels
        .filter((l: any) => l.class?.index === classIndex)
        .sort((a: any, b: any) => a.level - b.level);

      const cantripsKnown: number[] = [];
      const spellSlots: Record<string, number[]> = {};

      for (const lv of classLevels) {
        const sc = lv.spellcasting;
        if (!sc) continue;
        cantripsKnown.push(sc.cantrips_known ?? 0);
        for (let sl = 1; sl <= 9; sl++) {
          const key = String(sl);
          if (!spellSlots[key]) spellSlots[key] = [];
          spellSlots[key].push(sc[`spell_slots_level_${sl}`] ?? 0);
        }
      }

      spellcasting = { ability, cantripsKnown, spellSlots };
    }

    // Features
    const features = rawFeatures
      .filter((f: any) => f.class?.index === classIndex && !f.subclass)
      .map((f: any) => ({
        name: f.name,
        level: f.level,
        description: (f.desc || []).join("\n"),
      }))
      .sort((a: any, b: any) => a.level - b.level);

    const result: any = {
      name: c.name,
      hitDie: `d${c.hit_die}`,
      saveProficiencies,
      skillChoices,
      skillCount,
      weaponProficiencies,
      armorProficiencies,
      ...(spellcasting && { spellcasting }),
      features,
    };
    return result;
  });
}

// ---------- RACES ----------

function normalizeRaces() {
  const rawRaces = readRaw("5e-SRD-Races.json");
  const rawSubraces = readRaw("5e-SRD-Subraces.json");
  const rawTraits = readRaw("5e-SRD-Traits.json");

  // Build trait description lookup
  const traitDescs: Record<string, string> = {};
  for (const t of rawTraits) {
    traitDescs[t.index] = (t.desc || []).join("\n");
  }

  return rawRaces.map((r: any) => {
    const abilityBonuses = (r.ability_bonuses || []).map((ab: any) => ({
      stat: ab.ability_score.index,
      value: ab.bonus,
    }));

    const traits = (r.traits || []).map((t: any) => ({
      name: t.name,
      description: traitDescs[t.index] || "",
    }));

    const languages = (r.languages || []).map((l: any) => l.name);

    // Subraces
    const subraces = rawSubraces
      .filter((sr: any) => sr.race?.index === r.index)
      .map((sr: any) => ({
        name: sr.name,
        abilityBonuses: (sr.ability_bonuses || []).map((ab: any) => ({
          stat: ab.ability_score.index,
          value: ab.bonus,
        })),
        traits: (sr.racial_traits || []).map((t: any) => ({
          name: t.name,
          description: traitDescs[t.index] || "",
        })),
      }));

    const result: any = {
      name: r.name,
      speed: r.speed,
      size: r.size,
      abilityBonuses,
      traits,
      languages,
      ...(subraces.length && { subraces }),
    };
    return result;
  });
}

// ---------- MAIN ----------

function main() {
  if (!existsSync(RAW_DIR)) {
    console.error(`Raw data not found at ${RAW_DIR}`);
    console.error("Run: git clone --depth 1 https://github.com/5e-bits/5e-database.git data/raw/5e-database");
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(join(process.cwd(), "data/custom"), { recursive: true });

  console.log("Importing SRD data...\n");

  console.log("Spells:");
  writeOut("spells.json", normalizeSpells());

  console.log("Monsters:");
  writeOut("monsters.json", normalizeMonsters());

  console.log("Equipment:");
  writeOut("equipment.json", normalizeEquipment());

  console.log("Classes:");
  writeOut("classes.json", normalizeClasses());

  console.log("Races:");
  writeOut("races.json", normalizeRaces());

  // Pack metadata
  const srdPack = {
    name: "D&D 5e SRD (2014)",
    version: "1.0.0",
    source: "5e-bits/5e-database",
    categories: ["spells", "monsters", "equipment", "classes", "races"],
  };
  writeOut("pack.json", srdPack);

  const customPack = {
    name: "Custom / Homebrew",
    version: "1.0.0",
    categories: [],
    overrides: true,
  };
  writeFileSync(
    join(process.cwd(), "data/custom/pack.json"),
    JSON.stringify(customPack, null, 2) + "\n"
  );
  console.log("  ✓ custom/pack.json: written");

  console.log("\nDone!");
}

main();
