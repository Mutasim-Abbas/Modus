import { Star, User } from 'lucide-react';
import type { FoodCategory } from '@/types';

export interface FavouriteCardFood {
  id: string;
  name: string;
  category: FoodCategory;
  kcal: number;
}

interface FavouritesGridProps {
  items: readonly { food: FavouriteCardFood; isCustom: boolean; quickGrams: number }[];
  onQuickAdd: (foodId: string, grams: number) => void;
  onCustomize: (foodId: string) => void;
  onToggleFavourite: (foodId: string) => void;
}

/**
 * Favourites & quick-add (docs/DESIGN.md §7.3): a grid of cards, each a one-tap add at
 * the last portion used (or the food's first common portion, or 100 g). Tapping the
 * name instead opens the full portion step for a different amount.
 */
export function FavouritesGrid({
  items,
  onQuickAdd,
  onCustomize,
  onToggleFavourite,
}: FavouritesGridProps): JSX.Element {
  return (
    <ul className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      {items.map(({ food, isCustom, quickGrams }) => (
        <li
          key={food.id}
          className="flex flex-col gap-2 rounded-md border border-[color:var(--border)] bg-surface-2/70 p-3"
        >
          <div className="flex items-start justify-between gap-2">
            <button
              type="button"
              onClick={() => onCustomize(food.id)}
              className="min-w-0 flex-1 text-start"
            >
              <span className="flex items-center gap-1.5">
                {isCustom ? (
                  <User size={13} aria-hidden="true" className="shrink-0 text-gray-soft" />
                ) : null}
                <span className="line-clamp-2 text-sm font-semibold text-white">{food.name}</span>
              </span>
              <span className="mt-0.5 block text-[11px] text-gray tabular-nums">
                {food.kcal} kcal /100 g
              </span>
            </button>

            <button
              type="button"
              onClick={() => onToggleFavourite(food.id)}
              aria-label={`Remove ${food.name} from favourites`}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-sm text-gold transition-colors hover:text-white"
            >
              <Star size={16} aria-hidden="true" fill="currentColor" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => onQuickAdd(food.id, quickGrams)}
            className="min-h-[44px] rounded-md border border-[color:var(--border-strong)] bg-gold/15 text-xs font-bold text-white transition-colors hover:bg-gold/25"
          >
            + Add {Math.round(quickGrams)} g
          </button>
        </li>
      ))}
    </ul>
  );
}
