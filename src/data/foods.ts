import type { Food } from '@/types';

/**
 * Curated food database — APPROXIMATE REFERENCE VALUES PER 100 g.
 *
 * Basis: widely published composition values for common generic foods (of the kind found
 * in USDA FoodData Central and standard nutrition references), rounded to whole/one-decimal
 * figures. They describe a *typical* example of each food.
 *
 * These are estimates for everyday tracking, not clinical or medical data:
 *  - Real foods vary by cut, brand, ripeness, and preparation.
 *  - Cooked items assume plain preparation with no added fat unless the name says otherwise.
 *  - Macros may not multiply out to the listed kcal exactly; whole foods contain fibre,
 *    alcohol, and water that the 4/4/9 shorthand does not capture.
 *
 * The UI states this on the Log screen. Do not add decimal precision this data does not have.
 */

const f = (
  id: string,
  name: string,
  category: Food['category'],
  kcal: number,
  protein: number,
  carbs: number,
  fat: number,
  commonPortions: Food['commonPortions'],
): Food => ({ id, name, category, kcal, protein, carbs, fat, per: 100, commonPortions });

const SERVING = (grams: number): Food['commonPortions'] => [{ label: '1 serving', grams }];

export const FOODS: readonly Food[] = [
  /* ---------------------------- Protein ---------------------------- */
  f('chicken-breast', 'Chicken breast, cooked', 'protein', 165, 31, 0, 3.6, [
    { label: '1 breast', grams: 172 },
    { label: '100 g', grams: 100 },
  ]),
  f('chicken-thigh', 'Chicken thigh, cooked', 'protein', 209, 26, 0, 10.9, [
    { label: '1 thigh', grams: 111 },
  ]),
  f('chicken-whole-roast', 'Roast chicken, meat only', 'protein', 190, 29, 0, 7.4, SERVING(120)),
  f('turkey-breast', 'Turkey breast, cooked', 'protein', 135, 30, 0, 1, SERVING(120)),
  f('beef-mince-lean', 'Beef mince, lean, cooked', 'protein', 214, 27, 0, 11, SERVING(100)),
  f('beef-steak', 'Beef steak, lean, cooked', 'protein', 217, 30, 0, 10, [
    { label: '1 steak', grams: 200 },
  ]),
  f('lamb-cooked', 'Lamb, cooked', 'protein', 258, 25, 0, 17, SERVING(100)),
  f('pork-loin', 'Pork loin, cooked', 'protein', 242, 27, 0, 14, SERVING(120)),
  f('salmon', 'Salmon, cooked', 'protein', 208, 20, 0, 13, [{ label: '1 fillet', grams: 150 }]),
  f('tuna-canned-water', 'Tuna, canned in water', 'protein', 116, 26, 0, 1, [
    { label: '1 can, drained', grams: 120 },
  ]),
  f('sardines-canned', 'Sardines, canned in oil', 'protein', 208, 25, 0, 11, [
    { label: '1 can', grams: 90 },
  ]),
  f('cod', 'Cod, cooked', 'protein', 105, 23, 0, 0.9, [{ label: '1 fillet', grams: 150 }]),
  f('sea-bass', 'Sea bass, cooked', 'protein', 124, 24, 0, 2.6, [{ label: '1 fillet', grams: 150 }]),
  f('shrimp', 'Shrimp, cooked', 'protein', 99, 24, 0.2, 0.3, SERVING(85)),
  f('egg-whole', 'Egg, whole', 'protein', 143, 13, 0.7, 9.5, [
    { label: '1 large egg', grams: 50 },
    { label: '2 eggs', grams: 100 },
  ]),
  f('egg-white', 'Egg white', 'protein', 52, 11, 0.7, 0.2, [{ label: '1 white', grams: 33 }]),
  f('tofu-firm', 'Tofu, firm', 'protein', 144, 17, 2.8, 8.7, SERVING(100)),
  f('tempeh', 'Tempeh', 'protein', 192, 20, 7.6, 11, SERVING(100)),
  f('lentils-cooked', 'Lentils, cooked', 'protein', 116, 9, 20, 0.4, [{ label: '1 cup', grams: 198 }]),
  f('chickpeas-cooked', 'Chickpeas, cooked', 'protein', 164, 8.9, 27, 2.6, [
    { label: '1 cup', grams: 164 },
  ]),
  f('black-beans', 'Black beans, cooked', 'protein', 132, 8.9, 24, 0.5, [
    { label: '1 cup', grams: 172 },
  ]),
  f('kidney-beans', 'Kidney beans, cooked', 'protein', 127, 8.7, 23, 0.5, [
    { label: '1 cup', grams: 177 },
  ]),
  f('white-beans', 'White beans, cooked', 'protein', 139, 9.7, 25, 0.4, [
    { label: '1 cup', grams: 179 },
  ]),
  f('whey-protein', 'Whey protein powder', 'protein', 400, 80, 8, 5, [
    { label: '1 scoop', grams: 30 },
  ]),
  f('ham-sliced', 'Ham, sliced', 'protein', 145, 18, 1.5, 7, [{ label: '1 slice', grams: 28 }]),
  f('bacon', 'Bacon, cooked', 'protein', 541, 37, 1.4, 42, [{ label: '1 rasher', grams: 12 }]),
  f('sausage-beef', 'Beef sausage, cooked', 'protein', 290, 17, 3, 23, [
    { label: '1 sausage', grams: 60 },
  ]),
  f('liver-beef', 'Beef liver, cooked', 'protein', 175, 27, 5.1, 4.7, SERVING(85)),
  f('mackerel', 'Mackerel, cooked', 'protein', 262, 24, 0, 18, [{ label: '1 fillet', grams: 110 }]),
  f('anchovy', 'Anchovies, canned', 'protein', 210, 29, 0, 9.7, SERVING(20)),

  /* ---------------------------- Grains / carbs ---------------------------- */
  f('rice-white-cooked', 'White rice, cooked', 'grains', 130, 2.7, 28, 0.3, [
    { label: '1 cup', grams: 158 },
    { label: '1 bowl', grams: 200 },
  ]),
  f('rice-brown-cooked', 'Brown rice, cooked', 'grains', 123, 2.7, 26, 1, [
    { label: '1 cup', grams: 195 },
  ]),
  f('pasta-cooked', 'Pasta, cooked', 'grains', 158, 5.8, 31, 0.9, [
    { label: '1 cup', grams: 140 },
    { label: '1 plate', grams: 250 },
  ]),
  f('whole-wheat-pasta', 'Whole-wheat pasta, cooked', 'grains', 124, 5.3, 27, 0.5, [
    { label: '1 cup', grams: 140 },
  ]),
  f('bread-white', 'White bread', 'grains', 265, 9, 49, 3.2, [{ label: '1 slice', grams: 30 }]),
  f('bread-wholemeal', 'Wholemeal bread', 'grains', 247, 13, 41, 3.4, [
    { label: '1 slice', grams: 32 },
  ]),
  f('bread-sourdough', 'Sourdough bread', 'grains', 260, 11, 51, 1.7, [
    { label: '1 slice', grams: 50 },
  ]),
  f('oats-dry', 'Oats, dry', 'grains', 389, 17, 66, 6.9, [
    { label: '1/2 cup', grams: 40 },
    { label: '1 cup', grams: 80 },
  ]),
  f('oatmeal-cooked', 'Oatmeal, cooked in water', 'grains', 71, 2.5, 12, 1.5, [
    { label: '1 bowl', grams: 240 },
  ]),
  f('quinoa-cooked', 'Quinoa, cooked', 'grains', 120, 4.4, 21, 1.9, [{ label: '1 cup', grams: 185 }]),
  f('couscous-cooked', 'Couscous, cooked', 'grains', 112, 3.8, 23, 0.2, [
    { label: '1 cup', grams: 157 },
  ]),
  f('potato-boiled', 'Potato, boiled', 'grains', 87, 1.9, 20, 0.1, [
    { label: '1 medium', grams: 170 },
  ]),
  f('potato-baked', 'Potato, baked with skin', 'grains', 93, 2.5, 21, 0.1, [
    { label: '1 medium', grams: 173 },
  ]),
  f('sweet-potato', 'Sweet potato, baked', 'grains', 90, 2, 21, 0.2, [
    { label: '1 medium', grams: 130 },
  ]),
  f('fries', 'French fries', 'grains', 312, 3.4, 41, 15, [
    { label: 'small portion', grams: 70 },
    { label: 'medium portion', grams: 115 },
  ]),
  f('corn', 'Sweetcorn', 'grains', 96, 3.4, 21, 1.5, [{ label: '1 cup', grams: 165 }]),
  f('tortilla-wheat', 'Wheat tortilla', 'grains', 310, 8, 51, 8, [{ label: '1 tortilla', grams: 45 }]),
  f('bagel', 'Bagel, plain', 'grains', 250, 10, 49, 1.5, [{ label: '1 bagel', grams: 98 }]),
  f('croissant', 'Croissant', 'grains', 406, 8.2, 46, 21, [{ label: '1 croissant', grams: 57 }]),
  f('cereal-cornflakes', 'Cornflakes', 'grains', 357, 7.5, 84, 0.4, [{ label: '1 bowl', grams: 30 }]),
  f('granola', 'Granola', 'grains', 471, 10, 64, 20, [{ label: '1/2 cup', grams: 55 }]),
  f('noodles-egg', 'Egg noodles, cooked', 'grains', 138, 4.5, 25, 2.1, [
    { label: '1 cup', grams: 160 },
  ]),
  f('buckwheat-cooked', 'Buckwheat, cooked', 'grains', 92, 3.4, 20, 0.6, [
    { label: '1 cup', grams: 168 },
  ]),
  f('barley-cooked', 'Barley, cooked', 'grains', 123, 2.3, 28, 0.4, [{ label: '1 cup', grams: 157 }]),
  f('pita-bread', 'Pita bread', 'grains', 275, 9.1, 55, 1.2, [{ label: '1 pita', grams: 60 }]),

  /* ---------------------------- Dairy ---------------------------- */
  f('milk-whole', 'Milk, whole', 'dairy', 61, 3.2, 4.8, 3.3, [
    { label: '1 cup', grams: 244 },
    { label: '1 glass', grams: 200 },
  ]),
  f('milk-skim', 'Milk, skimmed', 'dairy', 34, 3.4, 5, 0.1, [{ label: '1 cup', grams: 245 }]),
  f('yogurt-plain', 'Yogurt, plain', 'dairy', 61, 3.5, 4.7, 3.3, [{ label: '1 pot', grams: 150 }]),
  f('greek-yogurt', 'Greek yogurt, plain', 'dairy', 97, 9, 3.9, 5, [{ label: '1 pot', grams: 170 }]),
  f('greek-yogurt-0', 'Greek yogurt, 0% fat', 'dairy', 59, 10, 3.6, 0.4, [
    { label: '1 pot', grams: 170 },
  ]),
  f('cottage-cheese', 'Cottage cheese', 'dairy', 98, 11, 3.4, 4.3, [{ label: '1 cup', grams: 226 }]),
  f('cheddar', 'Cheddar cheese', 'dairy', 403, 25, 1.3, 33, [{ label: '1 slice', grams: 28 }]),
  f('mozzarella', 'Mozzarella', 'dairy', 300, 22, 2.2, 22, [{ label: '1 ball', grams: 125 }]),
  f('feta', 'Feta cheese', 'dairy', 264, 14, 4.1, 21, SERVING(30)),
  f('parmesan', 'Parmesan', 'dairy', 431, 38, 4.1, 29, [{ label: '1 tbsp grated', grams: 5 }]),
  f('cream-cheese', 'Cream cheese', 'dairy', 342, 6, 4.1, 34, [{ label: '1 tbsp', grams: 15 }]),
  f('butter', 'Butter', 'dairy', 717, 0.9, 0.1, 81, [{ label: '1 tsp', grams: 5 }, { label: '1 tbsp', grams: 14 }]),
  f('ice-cream', 'Ice cream, vanilla', 'dairy', 207, 3.5, 24, 11, [{ label: '1 scoop', grams: 65 }]),
  f('kefir', 'Kefir, plain', 'dairy', 41, 3.3, 4.5, 1, [{ label: '1 glass', grams: 240 }]),

  /* ---------------------------- Fruit ---------------------------- */
  f('apple', 'Apple', 'fruit', 52, 0.3, 14, 0.2, [{ label: '1 medium', grams: 182 }]),
  f('banana', 'Banana', 'fruit', 89, 1.1, 23, 0.3, [{ label: '1 medium', grams: 118 }]),
  f('orange', 'Orange', 'fruit', 47, 0.9, 12, 0.1, [{ label: '1 medium', grams: 131 }]),
  f('grapes', 'Grapes', 'fruit', 69, 0.7, 18, 0.2, [{ label: '1 cup', grams: 151 }]),
  f('strawberries', 'Strawberries', 'fruit', 32, 0.7, 7.7, 0.3, [{ label: '1 cup', grams: 152 }]),
  f('blueberries', 'Blueberries', 'fruit', 57, 0.7, 14, 0.3, [{ label: '1 cup', grams: 148 }]),
  f('watermelon', 'Watermelon', 'fruit', 30, 0.6, 7.6, 0.2, [{ label: '1 wedge', grams: 286 }]),
  f('melon', 'Melon, cantaloupe', 'fruit', 34, 0.8, 8.2, 0.2, [{ label: '1 cup', grams: 160 }]),
  f('mango', 'Mango', 'fruit', 60, 0.8, 15, 0.4, [{ label: '1 medium', grams: 200 }]),
  f('pineapple', 'Pineapple', 'fruit', 50, 0.5, 13, 0.1, [{ label: '1 slice', grams: 84 }]),
  f('peach', 'Peach', 'fruit', 39, 0.9, 10, 0.3, [{ label: '1 medium', grams: 150 }]),
  f('pear', 'Pear', 'fruit', 57, 0.4, 15, 0.1, [{ label: '1 medium', grams: 178 }]),
  f('kiwi', 'Kiwi', 'fruit', 61, 1.1, 15, 0.5, [{ label: '1 fruit', grams: 75 }]),
  f('cherries', 'Cherries', 'fruit', 63, 1.1, 16, 0.2, [{ label: '1 cup', grams: 154 }]),
  f('pomegranate', 'Pomegranate seeds', 'fruit', 83, 1.7, 19, 1.2, [{ label: '1 cup', grams: 174 }]),
  f('fig-fresh', 'Fig, fresh', 'fruit', 74, 0.8, 19, 0.3, [{ label: '1 fig', grams: 50 }]),
  f('apricot-dried', 'Apricots, dried', 'fruit', 241, 3.4, 63, 0.5, SERVING(40)),
  f('raisins', 'Raisins', 'fruit', 299, 3.1, 79, 0.5, [{ label: '1 small box', grams: 43 }]),
  f('avocado', 'Avocado', 'fruit', 160, 2, 8.5, 15, [{ label: '1/2 avocado', grams: 100 }]),
  f('lemon', 'Lemon', 'fruit', 29, 1.1, 9.3, 0.3, [{ label: '1 lemon', grams: 58 }]),

  /* ---------------------------- Vegetables ---------------------------- */
  f('broccoli', 'Broccoli, cooked', 'vegetables', 35, 2.4, 7.2, 0.4, [{ label: '1 cup', grams: 156 }]),
  f('spinach', 'Spinach, raw', 'vegetables', 23, 2.9, 3.6, 0.4, [{ label: '1 cup', grams: 30 }]),
  f('carrot', 'Carrot, raw', 'vegetables', 41, 0.9, 10, 0.2, [{ label: '1 medium', grams: 61 }]),
  f('tomato', 'Tomato', 'vegetables', 18, 0.9, 3.9, 0.2, [{ label: '1 medium', grams: 123 }]),
  f('cucumber', 'Cucumber', 'vegetables', 15, 0.7, 3.6, 0.1, [{ label: '1 medium', grams: 201 }]),
  f('lettuce', 'Lettuce', 'vegetables', 15, 1.4, 2.9, 0.2, [{ label: '1 cup', grams: 47 }]),
  f('onion', 'Onion', 'vegetables', 40, 1.1, 9.3, 0.1, [{ label: '1 medium', grams: 110 }]),
  f('pepper-bell', 'Bell pepper', 'vegetables', 31, 1, 6, 0.3, [{ label: '1 medium', grams: 119 }]),
  f('courgette', 'Courgette / zucchini', 'vegetables', 17, 1.2, 3.1, 0.3, [
    { label: '1 medium', grams: 196 },
  ]),
  f('aubergine', 'Aubergine / eggplant', 'vegetables', 25, 1, 6, 0.2, [
    { label: '1 cup, cubed', grams: 82 },
  ]),
  f('cauliflower', 'Cauliflower', 'vegetables', 25, 1.9, 5, 0.3, [{ label: '1 cup', grams: 107 }]),
  f('green-beans', 'Green beans, cooked', 'vegetables', 35, 1.9, 7.9, 0.3, [
    { label: '1 cup', grams: 125 },
  ]),
  f('peas', 'Peas, cooked', 'vegetables', 84, 5.4, 16, 0.2, [{ label: '1 cup', grams: 160 }]),
  f('mushrooms', 'Mushrooms', 'vegetables', 22, 3.1, 3.3, 0.3, [{ label: '1 cup', grams: 70 }]),
  f('cabbage', 'Cabbage', 'vegetables', 25, 1.3, 5.8, 0.1, [{ label: '1 cup', grams: 89 }]),
  f('beetroot', 'Beetroot, cooked', 'vegetables', 44, 1.7, 10, 0.2, [{ label: '1 cup', grams: 170 }]),
  f('asparagus', 'Asparagus, cooked', 'vegetables', 22, 2.4, 4.1, 0.2, [
    { label: '1 cup', grams: 180 },
  ]),
  f('kale', 'Kale', 'vegetables', 35, 2.9, 4.4, 1.5, [{ label: '1 cup', grams: 21 }]),
  f('okra', 'Okra, cooked', 'vegetables', 22, 1.9, 4.5, 0.2, [{ label: '1 cup', grams: 160 }]),
  f('garlic', 'Garlic', 'vegetables', 149, 6.4, 33, 0.5, [{ label: '1 clove', grams: 3 }]),

  /* ---------------------------- Fats & nuts ---------------------------- */
  f('olive-oil', 'Olive oil', 'fats & nuts', 884, 0, 0, 100, [
    { label: '1 tsp', grams: 4.5 },
    { label: '1 tbsp', grams: 13.5 },
  ]),
  f('sunflower-oil', 'Sunflower oil', 'fats & nuts', 884, 0, 0, 100, [{ label: '1 tbsp', grams: 13.6 }]),
  f('almonds', 'Almonds', 'fats & nuts', 579, 21, 22, 50, [
    { label: '1 handful (~23)', grams: 28 },
  ]),
  f('walnuts', 'Walnuts', 'fats & nuts', 654, 15, 14, 65, [{ label: '1 handful', grams: 28 }]),
  f('cashews', 'Cashews', 'fats & nuts', 553, 18, 30, 44, [{ label: '1 handful', grams: 28 }]),
  f('pistachios', 'Pistachios', 'fats & nuts', 560, 20, 28, 45, [{ label: '1 handful', grams: 28 }]),
  f('hazelnuts', 'Hazelnuts', 'fats & nuts', 628, 15, 17, 61, [{ label: '1 handful', grams: 28 }]),
  f('peanuts', 'Peanuts', 'fats & nuts', 567, 26, 16, 49, [{ label: '1 handful', grams: 28 }]),
  f('peanut-butter', 'Peanut butter', 'fats & nuts', 588, 25, 20, 50, [
    { label: '1 tbsp', grams: 16 },
    { label: '2 tbsp', grams: 32 },
  ]),
  f('tahini', 'Tahini', 'fats & nuts', 595, 17, 21, 54, [{ label: '1 tbsp', grams: 15 }]),
  f('sunflower-seeds', 'Sunflower seeds', 'fats & nuts', 584, 21, 20, 51, SERVING(28)),
  f('pumpkin-seeds', 'Pumpkin seeds', 'fats & nuts', 559, 30, 11, 49, SERVING(28)),
  f('chia-seeds', 'Chia seeds', 'fats & nuts', 486, 17, 42, 31, [{ label: '1 tbsp', grams: 12 }]),
  f('flaxseed', 'Flaxseed, ground', 'fats & nuts', 534, 18, 29, 42, [{ label: '1 tbsp', grams: 7 }]),
  f('mayonnaise', 'Mayonnaise', 'fats & nuts', 680, 1, 0.6, 75, [{ label: '1 tbsp', grams: 14 }]),
  f('olives-green', 'Green olives', 'fats & nuts', 145, 1, 3.8, 15, [{ label: '5 olives', grams: 20 }]),
  f('olives-black', 'Black olives', 'fats & nuts', 115, 0.8, 6.3, 11, [
    { label: '5 olives', grams: 20 },
  ]),
  f('coconut-oil', 'Coconut oil', 'fats & nuts', 892, 0, 0, 99, [{ label: '1 tbsp', grams: 14 }]),

  /* ---------------------------- Snacks ---------------------------- */
  f('dark-chocolate', 'Dark chocolate, 70%', 'snacks', 598, 7.8, 46, 43, [
    { label: '1 square', grams: 10 },
    { label: '1 row', grams: 25 },
  ]),
  f('milk-chocolate', 'Milk chocolate', 'snacks', 535, 7.6, 59, 30, [{ label: '1 bar', grams: 45 }]),
  f('potato-chips', 'Potato chips / crisps', 'snacks', 536, 7, 53, 35, [
    { label: '1 small bag', grams: 30 },
  ]),
  f('popcorn-plain', 'Popcorn, air-popped', 'snacks', 387, 13, 78, 4.5, [
    { label: '1 bowl', grams: 25 },
  ]),
  f('biscuit-digestive', 'Digestive biscuit', 'snacks', 480, 6.8, 63, 22, [
    { label: '1 biscuit', grams: 15 },
  ]),
  f('cookie-chocolate-chip', 'Chocolate chip cookie', 'snacks', 488, 5.4, 64, 24, [
    { label: '1 cookie', grams: 30 },
  ]),
  f('protein-bar', 'Protein bar', 'snacks', 350, 30, 35, 9, [{ label: '1 bar', grams: 60 }]),
  f('granola-bar', 'Granola bar', 'snacks', 450, 7, 65, 18, [{ label: '1 bar', grams: 40 }]),
  f('pretzels', 'Pretzels', 'snacks', 380, 10, 80, 3, SERVING(30)),
  f('crackers', 'Crackers, plain', 'snacks', 431, 9, 71, 12, [{ label: '4 crackers', grams: 20 }]),
  f('donut', 'Donut, glazed', 'snacks', 452, 4.9, 51, 25, [{ label: '1 donut', grams: 60 }]),
  f('muffin-blueberry', 'Blueberry muffin', 'snacks', 377, 5.5, 54, 15, [
    { label: '1 muffin', grams: 100 },
  ]),
  f('honey', 'Honey', 'snacks', 304, 0.3, 82, 0, [{ label: '1 tbsp', grams: 21 }]),
  f('jam', 'Jam / preserve', 'snacks', 278, 0.4, 69, 0.1, [{ label: '1 tbsp', grams: 20 }]),
  f('sugar', 'Sugar, white', 'snacks', 387, 0, 100, 0, [{ label: '1 tsp', grams: 4 }]),

  /* ---------------------------- Drinks ---------------------------- */
  f('water', 'Water', 'drinks', 0, 0, 0, 0, [{ label: '1 glass', grams: 250 }]),
  f('coffee-black', 'Coffee, black', 'drinks', 1, 0.1, 0, 0, [{ label: '1 cup', grams: 240 }]),
  f('tea-black', 'Tea, no milk', 'drinks', 1, 0, 0.3, 0, [{ label: '1 cup', grams: 240 }]),
  f('orange-juice', 'Orange juice', 'drinks', 45, 0.7, 10, 0.2, [{ label: '1 glass', grams: 248 }]),
  f('apple-juice', 'Apple juice', 'drinks', 46, 0.1, 11, 0.1, [{ label: '1 glass', grams: 248 }]),
  f('cola', 'Cola', 'drinks', 42, 0, 11, 0, [
    { label: '1 can', grams: 330 },
    { label: '1 glass', grams: 250 },
  ]),
  f('cola-diet', 'Cola, diet', 'drinks', 0.4, 0.1, 0, 0, [{ label: '1 can', grams: 330 }]),
  f('beer', 'Beer, regular', 'drinks', 43, 0.5, 3.6, 0, [{ label: '1 bottle', grams: 330 }]),
  f('wine-red', 'Red wine', 'drinks', 85, 0.1, 2.6, 0, [{ label: '1 glass', grams: 150 }]),
  f('latte-whole-milk', 'Latte, whole milk', 'drinks', 55, 3, 5.3, 2.9, [
    { label: '1 medium', grams: 350 },
  ]),
  f('energy-drink', 'Energy drink', 'drinks', 45, 0, 11, 0, [{ label: '1 can', grams: 250 }]),
  f('smoothie-fruit', 'Fruit smoothie', 'drinks', 55, 0.9, 13, 0.3, [{ label: '1 bottle', grams: 250 }]),

  /* ---------------------- Turkish & Middle Eastern ---------------------- */
  f('bulgur-cooked', 'Bulgur, cooked', 'turkish & middle eastern', 83, 3.1, 19, 0.2, [
    { label: '1 cup', grams: 182 },
  ]),
  f('bulgur-pilav', 'Bulgur pilav', 'turkish & middle eastern', 130, 3.5, 23, 2.8, [
    { label: '1 plate', grams: 200 },
  ]),
  f('mercimek-corbasi', 'Lentil soup (mercimek çorbası)', 'turkish & middle eastern', 65, 3.2, 10, 1.4, [
    { label: '1 bowl', grams: 300 },
  ]),
  f('hummus', 'Hummus', 'turkish & middle eastern', 166, 7.9, 14, 9.6, [
    { label: '1 tbsp', grams: 15 },
    { label: '1 serving', grams: 60 },
  ]),
  f('labneh', 'Labneh', 'turkish & middle eastern', 174, 7.5, 6, 13, [{ label: '1 serving', grams: 50 }]),
  f('simit', 'Simit', 'turkish & middle eastern', 320, 9.5, 57, 5.5, [{ label: '1 simit', grams: 100 }]),
  f('ayran', 'Ayran', 'turkish & middle eastern', 37, 1.7, 2.8, 2, [
    { label: '1 cup', grams: 200 },
    { label: '1 bottle', grams: 300 },
  ]),
  f('dates', 'Dates, Medjool', 'turkish & middle eastern', 277, 1.8, 75, 0.2, [
    { label: '1 date', grams: 24 },
    { label: '3 dates', grams: 72 },
  ]),
  f('falafel', 'Falafel', 'turkish & middle eastern', 333, 13, 32, 18, [
    { label: '1 piece', grams: 17 },
    { label: '5 pieces', grams: 85 },
  ]),
  f('doner-chicken', 'Chicken döner, meat only', 'turkish & middle eastern', 215, 25, 2, 12, [
    { label: '1 portion', grams: 150 },
  ]),
  f('doner-beef', 'Beef döner, meat only', 'turkish & middle eastern', 280, 22, 2, 20, [
    { label: '1 portion', grams: 150 },
  ]),
  f('lahmacun', 'Lahmacun', 'turkish & middle eastern', 250, 10, 33, 8.5, [
    { label: '1 piece', grams: 130 },
  ]),
  f('pide-cheese', 'Kaşarlı pide', 'turkish & middle eastern', 275, 12, 33, 10, [
    { label: '1 pide', grams: 300 },
  ]),
  f('menemen', 'Menemen', 'turkish & middle eastern', 118, 6, 5, 8.5, [
    { label: '1 pan', grams: 250 },
  ]),
  f('kofte', 'Köfte, grilled', 'turkish & middle eastern', 245, 20, 4, 16, [
    { label: '1 köfte', grams: 30 },
    { label: '1 portion', grams: 150 },
  ]),
  f('adana-kebab', 'Adana kebab', 'turkish & middle eastern', 270, 19, 2, 21, [
    { label: '1 skewer', grams: 150 },
  ]),
  f('dolma', 'Dolma, stuffed vine leaves', 'turkish & middle eastern', 155, 2.6, 20, 7.5, [
    { label: '1 piece', grams: 25 },
  ]),
  f('borek-cheese', 'Peynirli börek', 'turkish & middle eastern', 290, 9, 28, 16, [
    { label: '1 slice', grams: 100 },
  ]),
  f('baklava', 'Baklava', 'turkish & middle eastern', 428, 6.2, 49, 24, [
    { label: '1 piece', grams: 35 },
  ]),
  f('kunefe', 'Künefe', 'turkish & middle eastern', 350, 7, 42, 18, [
    { label: '1 portion', grams: 150 },
  ]),
  f('tarhana-soup', 'Tarhana soup', 'turkish & middle eastern', 60, 2.3, 9.5, 1.5, [
    { label: '1 bowl', grams: 300 },
  ]),
  f('cacik', 'Cacık', 'turkish & middle eastern', 45, 2.2, 3.5, 2.4, [{ label: '1 bowl', grams: 150 }]),
  f('turkish-tea', 'Turkish tea', 'turkish & middle eastern', 1, 0, 0.3, 0, [
    { label: '1 glass', grams: 120 },
  ]),
  f('turkish-coffee', 'Turkish coffee', 'turkish & middle eastern', 9, 0.2, 1.6, 0.2, [
    { label: '1 cup', grams: 60 },
  ]),
  f('sucuk', 'Sucuk', 'turkish & middle eastern', 415, 21, 2, 36, [{ label: '3 slices', grams: 30 }]),
  f('beyaz-peynir', 'Beyaz peynir', 'turkish & middle eastern', 264, 14, 4.1, 21, SERVING(30)),
  f('tavuk-sis', 'Tavuk şiş', 'turkish & middle eastern', 185, 27, 1.5, 8, [
    { label: '1 skewer', grams: 150 },
  ]),
  f('pilav-rice-butter', 'Turkish rice pilav', 'turkish & middle eastern', 160, 3, 28, 4, [
    { label: '1 plate', grams: 200 },
  ]),
  f('kisir', 'Kısır', 'turkish & middle eastern', 180, 4, 30, 5, [{ label: '1 serving', grams: 150 }]),
  f('sutlac', 'Sütlaç', 'turkish & middle eastern', 145, 3.4, 25, 3.2, [
    { label: '1 bowl', grams: 150 },
  ]),
];

/** Stable lookup by id. */
export const FOOD_BY_ID: ReadonlyMap<string, Food> = new Map(FOODS.map((food) => [food.id, food]));

export function getFood(id: string): Food | undefined {
  return FOOD_BY_ID.get(id);
}

/** Shown wherever database numbers are displayed. */
export const FOOD_DATA_DISCLAIMER =
  'Approximate reference values per 100 g. Real foods vary by cut, brand and preparation — these are estimates for tracking, not clinical data.';
