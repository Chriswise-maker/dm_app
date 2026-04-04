import type { ActorSheet } from './kernel/actor-sheet';
import type { ActorState } from './kernel/actor-state';

const CURRENCY_TO_GP: Record<string, number> = {
  cp: 0.01,
  sp: 0.1,
  ep: 0.5,
  gp: 1,
  pp: 10,
};

export interface SrdEquipmentEntry {
  name: string;
  category: string;
  subcategory?: string;
  cost?: { amount: number; unit: string };
  weight?: number;
  damage?: { formula: string; type: string };
  properties?: string[];
  [key: string]: unknown;
}

export interface BuyResult {
  success: boolean;
  goldAfter: number;
  cost: number;
  item: { name: string; type: string; properties?: Record<string, unknown> };
  error?: string;
}

export interface SellResult {
  success: boolean;
  goldAfter: number;
  refund: number;
  itemName: string;
  error?: string;
}

export function getGoldCost(entry: SrdEquipmentEntry): number {
  if (!entry.cost) return 0;
  const multiplier = CURRENCY_TO_GP[entry.cost.unit] ?? 1;
  return entry.cost.amount * multiplier;
}

export function buyItem(
  sheet: ActorSheet,
  state: ActorState,
  entry: SrdEquipmentEntry,
): BuyResult {
  const cost = getGoldCost(entry);

  if (state.gold < cost) {
    return {
      success: false,
      goldAfter: state.gold,
      cost,
      item: { name: entry.name, type: entry.category },
      error: `Not enough gold. Need ${cost} gp, have ${state.gold} gp.`,
    };
  }

  const equipmentEntry: { name: string; type: string; properties?: Record<string, unknown> } = {
    name: entry.name,
    type: entry.category,
  };

  const props: Record<string, unknown> = {};
  if (entry.damage) props.damage = entry.damage;
  if (entry.properties) props.itemProperties = entry.properties;
  if (entry.weight != null) props.weight = entry.weight;
  if (Object.keys(props).length > 0) equipmentEntry.properties = props;

  return {
    success: true,
    goldAfter: Math.round((state.gold - cost) * 100) / 100,
    cost,
    item: equipmentEntry,
  };
}

export function sellItem(
  sheet: ActorSheet,
  state: ActorState,
  itemName: string,
  srdEntry?: SrdEquipmentEntry,
): SellResult {
  const idx = sheet.equipment.findIndex(
    e => e.name.toLowerCase() === itemName.toLowerCase(),
  );

  if (idx === -1) {
    return {
      success: false,
      goldAfter: state.gold,
      refund: 0,
      itemName,
      error: `Item "${itemName}" not found in equipment.`,
    };
  }

  const refund = srdEntry ? Math.round(getGoldCost(srdEntry) * 50) / 100 : 0;

  return {
    success: true,
    goldAfter: Math.round((state.gold + refund) * 100) / 100,
    refund,
    itemName,
  };
}
