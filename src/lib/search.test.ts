import { describe, expect, it } from 'vitest';
import type { Food } from '@/types';
import { FOODS } from '@/data/foods';
import {
  MatchRank,
  foodsByCategory,
  listCategories,
  normalize,
  rankFood,
  searchFoods,
  searchFoodsRanked,
} from '@/lib/search';

const food = (id: string, name: string, category: Food['category']): Food => ({
  id,
  name,
  category,
  kcal: 100,
  protein: 10,
  carbs: 10,
  fat: 1,
  per: 100,
  commonPortions: [{ label: '1 serving', grams: 100 }],
});

const FIXTURES: Food[] = [
  food('rice', 'Rice', 'grains'),
  food('brown-rice', 'Brown rice, cooked', 'grains'),
  food('rice-cakes', 'Rice cakes', 'snacks'),
  food('chicken-and-rice', 'Chicken with rice', 'protein'),
  food('milk', 'Milk, whole', 'dairy'),
  food('kunefe', 'Künefe', 'turkish & middle eastern'),
];

describe('normalize', () => {
  it('lowercases and trims', () => {
    expect(normalize('  Chicken Breast  ')).toBe('chicken breast');
  });

  it('collapses internal whitespace', () => {
    expect(normalize('brown    rice')).toBe('brown rice');
  });

  it('strips diacritics so ASCII typing finds accented names', () => {
    expect(normalize('Künefe')).toBe('kunefe');
    expect(normalize('mercimek çorbası')).toBe('mercimek corbasi');
  });

  it('handles an empty string', () => {
    expect(normalize('')).toBe('');
    expect(normalize('   ')).toBe('');
  });
});

describe('rankFood', () => {
  const rice = food('rice', 'Rice', 'grains');
  const brownRice = food('brown-rice', 'Brown rice, cooked', 'grains');

  it('ranks an exact name match highest', () => {
    expect(rankFood(rice, 'rice')).toBe(MatchRank.Exact);
  });

  it('ranks a name prefix above a word prefix', () => {
    expect(rankFood(brownRice, 'brown')).toBe(MatchRank.Prefix);
    expect(rankFood(brownRice, 'rice')).toBe(MatchRank.WordPrefix);
    expect(MatchRank.Prefix).toBeGreaterThan(MatchRank.WordPrefix);
  });

  it('ranks a substring below a word prefix', () => {
    expect(rankFood(brownRice, 'ooked')).toBe(MatchRank.Substring);
    expect(MatchRank.WordPrefix).toBeGreaterThan(MatchRank.Substring);
  });

  it('falls back to a category match', () => {
    expect(rankFood(rice, 'grains')).toBe(MatchRank.Category);
    expect(MatchRank.Substring).toBeGreaterThan(MatchRank.Category);
  });

  it('returns None for no match and for an empty query', () => {
    expect(rankFood(rice, 'pizza')).toBe(MatchRank.None);
    expect(rankFood(rice, '')).toBe(MatchRank.None);
  });
});

describe('searchFoods — ordering', () => {
  it('orders prefix matches above substring matches', () => {
    const results = searchFoods('rice', { foods: FIXTURES });
    expect(results[0]?.name).toBe('Rice'); // exact
    // "Rice cakes" (prefix) must beat "Chicken with rice" (word prefix, later in name)
    expect(results.findIndex((f) => f.name === 'Rice cakes')).toBeLessThan(
      results.findIndex((f) => f.name === 'Chicken with rice'),
    );
  });

  it('breaks rank ties by shorter name first', () => {
    const results = searchFoodsRanked('rice', { foods: FIXTURES });
    const prefixMatches = results.filter((r) => r.rank === MatchRank.Prefix);
    const names = prefixMatches.map((r) => r.food.name);
    expect(names).toEqual([...names].sort((a, b) => a.length - b.length));
  });

  it('is deterministic across calls', () => {
    expect(searchFoods('rice', { foods: FIXTURES })).toEqual(
      searchFoods('rice', { foods: FIXTURES }),
    );
  });
});

describe('searchFoods — matching', () => {
  it('returns nothing for an empty or whitespace query', () => {
    expect(searchFoods('', { foods: FIXTURES })).toEqual([]);
    expect(searchFoods('   ', { foods: FIXTURES })).toEqual([]);
  });

  it('matches partial words', () => {
    expect(searchFoods('chick', { foods: FIXTURES }).map((f) => f.name)).toContain(
      'Chicken with rice',
    );
  });

  it('is case-insensitive', () => {
    expect(searchFoods('RICE', { foods: FIXTURES })).toEqual(searchFoods('rice', { foods: FIXTURES }));
  });

  it('finds accented names typed without accents', () => {
    expect(searchFoods('kunefe', { foods: FIXTURES }).map((f) => f.name)).toEqual(['Künefe']);
  });

  it('returns an empty array for a query that matches nothing', () => {
    expect(searchFoods('zzzznotafood', { foods: FIXTURES })).toEqual([]);
  });

  it('respects the limit option', () => {
    expect(searchFoods('rice', { foods: FIXTURES, limit: 2 })).toHaveLength(2);
  });

  it('filters by category', () => {
    const results = searchFoods('rice', { foods: FIXTURES, category: 'snacks' });
    expect(results.map((f) => f.name)).toEqual(['Rice cakes']);
  });
});

describe('searchFoods — against the real database', () => {
  it('finds chicken breast by prefix', () => {
    expect(searchFoods('chicken')[0]?.name.toLowerCase()).toContain('chicken');
  });

  it('finds Turkish staples the brief calls out', () => {
    for (const query of ['bulgur', 'hummus', 'labneh', 'simit', 'ayran', 'dates', 'lentil']) {
      expect(searchFoods(query).length, `expected a result for "${query}"`).toBeGreaterThan(0);
    }
  });

  it('surfaces a whole category when the query is a category name', () => {
    const results = searchFoods('dairy', { limit: -1 });
    expect(results.length).toBeGreaterThan(5);
    expect(results.every((f) => f.category === 'dairy')).toBe(true);
  });

  it('stays fast across a full sweep of the database', () => {
    const start = performance.now();
    for (const item of FOODS) searchFoods(item.name.slice(0, 4));
    const elapsed = performance.now() - start;
    // ~180 queries over ~180 rows. Generous bound; catches accidental O(n^3).
    expect(elapsed).toBeLessThan(500);
  });
});

describe('foodsByCategory', () => {
  it('returns only that category, alphabetically', () => {
    const results = foodsByCategory('grains', FIXTURES);
    expect(results.map((f) => f.name)).toEqual(['Brown rice, cooked', 'Rice']);
  });

  it('returns an empty array for a category with no foods', () => {
    expect(foodsByCategory('drinks', FIXTURES)).toEqual([]);
  });
});

describe('listCategories', () => {
  it('lists only categories present, in display order', () => {
    expect(listCategories(FIXTURES)).toEqual([
      'protein',
      'grains',
      'dairy',
      'snacks',
      'turkish & middle eastern',
    ]);
  });

  it('covers every category in the real database', () => {
    const categories = listCategories();
    const present = new Set(FOODS.map((f) => f.category));
    expect(new Set(categories)).toEqual(present);
  });
});
