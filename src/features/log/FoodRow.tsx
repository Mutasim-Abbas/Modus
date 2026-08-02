import type { ReactNode } from 'react';
import { Plus, Star, User } from 'lucide-react';
import type { FoodCategory } from '@/types';
import { cn } from '@/lib/cn';

export interface FoodRowFood {
  id: string;
  name: string;
  category: FoodCategory;
  kcal: number;
}

interface FoodRowProps {
  food: FoodRowFood;
  /** True for a user-entered food — must be visually distinguishable, never just labelled. */
  isCustom: boolean;
  favourite: boolean;
  onToggleFavourite: () => void;
  onSelect: () => void;
  /** Extra controls (edit/delete) appended after the favourite star — used by "Mine". */
  trailing?: ReactNode;
}

/**
 * A single food result row (docs/DESIGN.md §7.3): tapping the row opens the portion
 * step, the star is a separate sibling control (never nested inside the row button —
 * two interactive elements, not one button inside another).
 */
export function FoodRow({
  food,
  isCustom,
  favourite,
  onToggleFavourite,
  onSelect,
  trailing,
}: FoodRowProps): JSX.Element {
  return (
    <div className="flex items-center gap-1 rounded-md border border-[color:var(--border)] bg-surface-2/70 transition-colors hover:border-[color:var(--border-strong)] hover:bg-surface-3">
      {/*
        The accessible name is set explicitly rather than left to be concatenated from the
        row's contents. Two reasons, and the second is the one that bit:

        1. Assistive tech announces the food NAME first. Screen-reader users navigating a
           results list by first letter, and anyone using voice control ("click banana"),
           both depend on the name leading. A custom food's badge used to be rendered as an
           sr-only span BEFORE the name, so every custom row announced as "Custom food,
           your own numbers, My protein shake …" and could not be addressed by its name.
        2. It keeps the visual badge purely visual (`aria-hidden`), so the "this is your
           own number" marker is stated exactly once instead of being read twice.
      */}
      <button
        type="button"
        onClick={onSelect}
        aria-label={`${food.name}, ${isCustom ? 'custom food, your own numbers' : food.category}, ${food.kcal} kcal per 100 g`}
        className="flex min-w-0 flex-1 items-center gap-3 px-3.5 py-3 text-start"
      >
        {isCustom ? (
          <span
            aria-hidden="true"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-surface-3 text-gray-soft"
            title="Custom · your numbers"
          >
            <User size={16} aria-hidden="true" />
          </span>
        ) : null}

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-white">{food.name}</span>
          <span className="block text-[11px] text-gray tabular-nums">
            {isCustom ? 'Custom' : <span className="capitalize">{food.category}</span>}
            {' · '}
            {food.kcal} kcal /100 g
          </span>
        </span>

        <Plus size={16} aria-hidden="true" className="shrink-0 text-gray-soft" />
      </button>

      <button
        type="button"
        onClick={onToggleFavourite}
        aria-pressed={favourite}
        aria-label={`${favourite ? 'Remove' : 'Add'} ${food.name} ${favourite ? 'from' : 'to'} favourites`}
        className={cn(
          'grid h-11 w-11 shrink-0 place-items-center rounded-sm transition-colors',
          favourite ? 'text-gold' : 'text-gray-soft hover:text-white',
        )}
      >
        <Star size={18} aria-hidden="true" fill={favourite ? 'currentColor' : 'none'} />
      </button>

      {trailing}
    </div>
  );
}
