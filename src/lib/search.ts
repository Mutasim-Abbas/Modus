import type { Food, FoodCategory } from '@/types';
import { FOODS } from '@/data/foods';

/**
 * Food search — pure and synchronous. The whole database is ~180 rows, so a linear
 * scan per keystroke is well under a frame; no index or debounce complexity needed.
 *
 * Ranking (highest first):
 *   1. exact name match
 *   2. name starts with the query
 *   3. a word inside the name starts with the query  ("rice" -> "Brown rice, cooked")
 *   4. name contains the query anywhere
 *   5. category contains the query               ("dairy" -> every dairy item)
 * Ties break on shorter name first (a closer match), then alphabetically for stability.
 */

export const MatchRank = {
  None: 0,
  Category: 1,
  Substring: 2,
  WordPrefix: 3,
  Prefix: 4,
  Exact: 5,
} as const;

export type MatchRank = (typeof MatchRank)[keyof typeof MatchRank];

export interface SearchResult {
  food: Food;
  rank: MatchRank;
}

/**
 * Letters that NFD cannot decompose into "base + combining mark", because they are
 * distinct letters rather than accented ones. Turkish dotless ı is the one that matters
 * here: without this, "corbasi" would never match "çorbası".
 */
const LETTER_FOLDING: Record<string, string> = {
  ı: 'i',
  İ: 'i',
  ø: 'o',
  Ø: 'o',
  đ: 'd',
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
};

const FOLDABLE = new RegExp(`[${Object.keys(LETTER_FOLDING).join('')}]`, 'g');

/**
 * Lowercase, trim, collapse whitespace, and fold accents so ASCII typing finds
 * "Künefe" and "mercimek çorbası".
 */
export function normalize(text: string): string {
  return text
    .replace(FOLDABLE, (char) => LETTER_FOLDING[char] ?? char)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export function rankFood(food: Food, normalizedQuery: string): MatchRank {
  if (!normalizedQuery) return MatchRank.None;

  const name = normalize(food.name);
  if (name === normalizedQuery) return MatchRank.Exact;
  if (name.startsWith(normalizedQuery)) return MatchRank.Prefix;

  const words = name.split(/[\s,/-]+/).filter(Boolean);
  if (words.some((word) => word.startsWith(normalizedQuery))) return MatchRank.WordPrefix;

  if (name.includes(normalizedQuery)) return MatchRank.Substring;
  if (normalize(food.category).includes(normalizedQuery)) return MatchRank.Category;

  return MatchRank.None;
}

export interface SearchOptions {
  limit?: number;
  category?: FoodCategory | 'all';
  /** Defaults to the bundled database; injectable for tests. */
  foods?: readonly Food[];
}

/** Returns matching foods, best first. An empty query returns an empty list. */
export function searchFoods(query: string, options: SearchOptions = {}): Food[] {
  return searchFoodsRanked(query, options).map((result) => result.food);
}

/** Same as searchFoods but keeps the rank — used by tests and by result grouping. */
export function searchFoodsRanked(query: string, options: SearchOptions = {}): SearchResult[] {
  const { limit = 30, category = 'all', foods = FOODS } = options;
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];

  const pool = category === 'all' ? foods : foods.filter((food) => food.category === category);

  const results: SearchResult[] = [];
  for (const food of pool) {
    const rank = rankFood(food, normalizedQuery);
    if (rank !== MatchRank.None) results.push({ food, rank });
  }

  results.sort((a, b) => {
    if (a.rank !== b.rank) return b.rank - a.rank;
    if (a.food.name.length !== b.food.name.length) return a.food.name.length - b.food.name.length;
    return a.food.name.localeCompare(b.food.name);
  });

  return limit >= 0 ? results.slice(0, limit) : results;
}

/** Foods in a category, alphabetical — powers the browse view when the query is empty. */
export function foodsByCategory(
  category: FoodCategory,
  foods: readonly Food[] = FOODS,
): Food[] {
  return foods
    .filter((food) => food.category === category)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Every category present in the database, in a stable display order. */
export function listCategories(foods: readonly Food[] = FOODS): FoodCategory[] {
  const order: FoodCategory[] = [
    'protein',
    'grains',
    'dairy',
    'fruit',
    'vegetables',
    'fats & nuts',
    'snacks',
    'drinks',
    'turkish & middle eastern',
  ];
  const present = new Set(foods.map((food) => food.category));
  return order.filter((category) => present.has(category));
}
