import { useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  History as HistoryIcon,
  Info,
  Pencil,
  Plus,
  Search,
  SearchX,
  Star,
  Trash2,
  UserRoundPen,
  UtensilsCrossed,
} from 'lucide-react';
import type { CustomFood, DayKey, Food, FoodCategory, MealSlot } from '@/types';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { InlineDeleteConfirm } from '@/components/InlineDeleteConfirm';
import { Sheet } from '@/components/Sheet';
import { FOODS, FOOD_DATA_DISCLAIMER } from '@/data/foods';
import { foodsByCategory, listCategories, searchFoods } from '@/lib/search';
import { macrosForGrams, sumMacros } from '@/lib/macros';
import { addDays, formatDayLabel, isDayKey, toDayKey } from '@/lib/date';
import { selectCustomFoods, selectDay, selectFavouriteIds } from '@/lib/store';
import { useAppState, useStore } from '@/lib/useStore';
import { cn } from '@/lib/cn';
import { CopyDayConfirm } from '@/features/log/CopyDayConfirm';
import { CustomFoodForm } from '@/features/log/CustomFoodForm';
import { FavouritesGrid } from '@/features/log/FavouritesGrid';
import { FoodRow } from '@/features/log/FoodRow';
import { MealList } from '@/features/log/MealList';
import { PortionPanel } from '@/features/log/PortionPanel';
import { SyncChip } from '@/features/sync/SyncChip';
import { MEAL_LABELS, MEAL_ORDER, suggestMeal } from '@/features/log/meals';
import { selectRecentFoodRefs } from '@/features/log/recentFoods';

const CATEGORIES = listCategories();

/** Why the copy chip is disabled — docs/DESIGN.md §7.3 and empty state E-3 (§14). */
const NOTHING_TO_COPY = 'nothing logged yesterday';

type LogView = 'all' | 'favourites' | 'mine' | 'recent';

const VIEW_OPTIONS: { value: LogView; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'favourites', label: 'Favourites ★' },
  { value: 'mine', label: 'Mine' },
  { value: 'recent', label: 'Recent' },
];

interface SelectedFood {
  food: Food;
  isCustom: boolean;
  initialGrams?: number;
}

interface CustomFoodSheetState {
  initial?: CustomFood;
  defaultName?: string;
}

export function LogScreen(): JSX.Element {
  const store = useStore();
  const state = useAppState();
  const today = toDayKey();

  const [day, setDay] = useState<DayKey>(today);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<FoodCategory | 'all'>('all');
  const [view, setView] = useState<LogView>('all');
  const [selected, setSelected] = useState<SelectedFood | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [customFoodSheet, setCustomFoodSheet] = useState<CustomFoodSheetState | null>(null);
  const [confirmingCustomId, setConfirmingCustomId] = useState<string | null>(null);
  const [showCopyConfirm, setShowCopyConfirm] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const customFoods = useMemo(() => selectCustomFoods(state), [state]);
  const customFoodIds = useMemo(() => new Set(customFoods.map((food) => food.id)), [customFoods]);
  const favouriteIds = useMemo(() => new Set(selectFavouriteIds(state)), [state]);
  const allFoods = useMemo<Food[]>(() => [...FOODS, ...customFoods], [customFoods]);
  const recentRefs = useMemo(() => selectRecentFoodRefs(state, today), [state, today]);
  const recentByFoodId = useMemo(
    () => new Map(recentRefs.map((ref) => [ref.foodId, ref])),
    [recentRefs],
  );

  const dayLog = useMemo(() => selectDay(state, day), [state, day]);
  const sourceDay = addDays(day, -1);
  const sourceDayLog = useMemo(() => selectDay(state, sourceDay), [state, sourceDay]);
  const canGoForward = addDays(day, 1).localeCompare(today) <= 0;
  const canCopySourceDay = sourceDayLog.entries.length > 0;

  // ~180+ rows: a linear scan per keystroke is far cheaper than a debounce would cost us.
  const results = useMemo<Food[]>(() => {
    if (view === 'favourites') {
      const favFoods = allFoods.filter((food) => favouriteIds.has(food.id));
      return query.trim() ? searchFoods(query, { foods: favFoods, limit: 60 }) : favFoods;
    }
    if (view === 'mine') {
      const mine = [...customFoods].sort((a, b) => a.name.localeCompare(b.name));
      return query.trim() ? searchFoods(query, { foods: mine, limit: 60 }) : mine;
    }
    if (view === 'recent') {
      const recent = recentRefs
        .map((ref) => allFoods.find((food) => food.id === ref.foodId))
        .filter((food): food is Food => food !== undefined);
      return query.trim() ? searchFoods(query, { foods: recent, limit: 60 }) : recent;
    }
    if (query.trim()) return searchFoods(query, { category, foods: allFoods, limit: 40 });
    if (category !== 'all') return foodsByCategory(category, allFoods);
    return [];
  }, [view, query, category, allFoods, favouriteIds, customFoods, recentRefs]);

  const handleAdd = (food: Food, grams: number, meal: MealSlot): void => {
    const macros = macrosForGrams(food, grams);
    store.addEntry(
      {
        foodId: food.id,
        name: food.name,
        grams,
        kcal: macros.kcal,
        protein: macros.protein,
        carbs: macros.carbs,
        fat: macros.fat,
        meal,
        source: 'food-db',
      },
      day,
    );

    setSelected(null);
    setQuery('');
    setConfirmation(
      day === today
        ? `${food.name} added to ${MEAL_LABELS[meal]}.`
        : `${food.name} added to ${MEAL_LABELS[meal]} on ${formatDayLabel(day, today)}.`,
    );
    // Return focus to the search box so logging several foods stays keyboard-friendly.
    requestAnimationFrame(() => searchRef.current?.focus());
  };

  const handleQuickAdd = (foodId: string, grams: number): void => {
    const food = allFoods.find((item) => item.id === foodId);
    if (!food) return;
    const meal = suggestMeal();
    const macros = macrosForGrams(food, grams);
    store.addEntry(
      {
        foodId: food.id,
        name: food.name,
        grams,
        kcal: macros.kcal,
        protein: macros.protein,
        carbs: macros.carbs,
        fat: macros.fat,
        meal,
        source: 'food-db',
      },
      day,
    );
    setConfirmation(`${food.name} added to ${MEAL_LABELS[meal]}.`);
  };

  const handleCustomFoodSaved = (food: CustomFood): void => {
    setCustomFoodSheet(null);
    setView('mine');
    setQuery('');
    setConfirmation(`"${food.name}" saved to your foods.`);
  };

  const handleCopyConfirm = (selectedIds: readonly string[]): void => {
    if (selectedIds.length === sourceDayLog.entries.length) {
      store.copyDay(sourceDay, day);
    } else {
      for (const entry of sourceDayLog.entries) {
        if (!selectedIds.includes(entry.id)) continue;
        const base = {
          name: entry.name,
          grams: entry.grams,
          kcal: entry.kcal,
          protein: entry.protein,
          carbs: entry.carbs,
          fat: entry.fat,
          meal: entry.meal,
          source: entry.source,
        };
        store.addEntry(entry.foodId === undefined ? base : { ...base, foodId: entry.foodId }, day);
      }
    }
    setShowCopyConfirm(false);
    setConfirmation(
      `Copied ${selectedIds.length} ${selectedIds.length === 1 ? 'entry' : 'entries'} to ${formatDayLabel(day, today)}.`,
    );
  };

  if (selected) {
    return (
      <PortionPanel
        food={selected.food}
        isCustom={selected.isCustom}
        {...(selected.initialGrams !== undefined ? { initialGrams: selected.initialGrams } : {})}
        defaultMeal={suggestMeal()}
        onBack={() => setSelected(null)}
        onAdd={(grams, meal) => handleAdd(selected.food, grams, meal)}
      />
    );
  }

  const renderRow = (food: Food): JSX.Element => (
    <li key={food.id}>
      <FoodRow
        food={food}
        isCustom={customFoodIds.has(food.id)}
        favourite={favouriteIds.has(food.id)}
        onToggleFavourite={() => store.toggleFavourite(food.id)}
        onSelect={() => setSelected({ food, isCustom: customFoodIds.has(food.id) })}
      />
    </li>
  );

  let resultsSection: JSX.Element;

  if (view === 'mine') {
    if (customFoods.length === 0) {
      resultsSection = (
        <EmptyState
          icon={UserRoundPen}
          title="No foods of your own yet"
          description="Add anything the database doesn't have — your own recipe, a local brand, your protein shake."
          action={
            <Button size="sm" className="mt-1" onClick={() => setCustomFoodSheet({})}>
              <Plus size={16} aria-hidden="true" />
              Add a custom food
            </Button>
          }
        />
      );
    } else if (results.length === 0) {
      resultsSection = (
        <EmptyState
          icon={SearchX}
          title={`No custom foods match “${query.trim()}”`}
          description="Try a different word, or clear the search to see all your foods."
        />
      );
    } else {
      resultsSection = (
        <ul className="flex flex-col gap-2">
          {results.map((food) => {
            if (confirmingCustomId === food.id) {
              return (
                <li key={food.id}>
                  <InlineDeleteConfirm
                    message={`Delete "${food.name}" from your foods? Anything already logged with it keeps its numbers.`}
                    onConfirm={() => {
                      store.removeCustomFood(food.id);
                      setConfirmingCustomId(null);
                    }}
                    onCancel={() => setConfirmingCustomId(null)}
                  />
                </li>
              );
            }

            return (
              <li key={food.id}>
                <FoodRow
                  food={food}
                  isCustom
                  favourite={favouriteIds.has(food.id)}
                  onToggleFavourite={() => store.toggleFavourite(food.id)}
                  onSelect={() => setSelected({ food, isCustom: true })}
                  trailing={
                    <>
                      <button
                        type="button"
                        onClick={() => setCustomFoodSheet({ initial: food as CustomFood })}
                        aria-label={`Edit ${food.name}`}
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-sm text-gray-soft transition-colors hover:bg-surface-3 hover:text-white"
                      >
                        <Pencil size={16} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingCustomId(food.id)}
                        aria-label={`Delete ${food.name}`}
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-sm text-gray-soft transition-colors hover:bg-surface-3 hover:text-danger"
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    </>
                  }
                />
              </li>
            );
          })}
        </ul>
      );
    }
  } else if (view === 'favourites') {
    if (results.length === 0) {
      resultsSection = (
        <EmptyState
          icon={Star}
          title="No favourites yet"
          description="Tap the star on any food and it lands here for one-tap logging."
          action={
            <Button size="sm" className="mt-1" onClick={() => setView('all')}>
              Browse foods
            </Button>
          }
        />
      );
    } else {
      resultsSection = (
        <FavouritesGrid
          items={results.map((food) => ({
            food,
            isCustom: customFoodIds.has(food.id),
            quickGrams:
              recentByFoodId.get(food.id)?.lastGrams ?? food.commonPortions[0]?.grams ?? 100,
          }))}
          onQuickAdd={handleQuickAdd}
          onCustomize={(foodId) => {
            const food = allFoods.find((item) => item.id === foodId);
            if (!food) return;
            const lastGrams = recentByFoodId.get(foodId)?.lastGrams;
            setSelected(
              lastGrams !== undefined
                ? { food, isCustom: customFoodIds.has(foodId), initialGrams: lastGrams }
                : { food, isCustom: customFoodIds.has(foodId) },
            );
          }}
          onToggleFavourite={(foodId) => store.toggleFavourite(foodId)}
        />
      );
    }
  } else if (view === 'recent') {
    resultsSection =
      results.length > 0 ? (
        <ul className="flex flex-col gap-2">{results.map(renderRow)}</ul>
      ) : (
        <EmptyState
          icon={HistoryIcon}
          title="Nothing recent"
          description="Foods you log show up here so you can add them again in one tap."
        />
      );
  } else if (results.length > 0) {
    resultsSection = <ul className="flex flex-col gap-2">{results.map(renderRow)}</ul>;
  } else if (query.trim()) {
    resultsSection = (
      <EmptyState
        icon={SearchX}
        title={`No food matches “${query.trim()}”`}
        description="Check the spelling, try a shorter word, or add it as your own food."
        action={
          <Button
            size="sm"
            className="mt-1"
            onClick={() => setCustomFoodSheet({ defaultName: query.trim() })}
          >
            <Plus size={16} aria-hidden="true" />
            Create “{query.trim()}” as a custom food
          </Button>
        }
      />
    );
  } else {
    resultsSection = (
      <EmptyState
        icon={Search}
        title="Search the food database"
        description={`Start typing, or pick a category above to browse all ${FOODS.length} foods.`}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="mb-1">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="eyebrow">Log</span>
            <h1 className="text-2xl font-extrabold leading-tight">Add food</h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="lg:hidden">
              <SyncChip />
            </div>
            <Button size="sm" variant="secondary" onClick={() => setCustomFoodSheet({})}>
              <Plus size={16} aria-hidden="true" />
              Custom food
            </Button>
          </div>
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-gray">
          Search {FOODS.length + customFoods.length} foods, pick a portion, and it lands on{' '}
          {day === today ? "today's" : `${formatDayLabel(day, today)}'s`} totals.
        </p>
      </header>

      {/* Date stepper — how backdating works (docs/DESIGN.md §7.3). */}
      <div className="flex items-center justify-between gap-2 rounded-md border border-[color:var(--border)] bg-surface-2/60 px-2 py-2">
        <button
          type="button"
          onClick={() => setDay(addDays(day, -1))}
          aria-label="Previous day"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-sm text-gray transition-colors hover:bg-surface-3 hover:text-white"
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>

        <div className="flex flex-1 flex-col items-center gap-0.5">
          <button
            type="button"
            onClick={() => setDatePickerOpen((current) => !current)}
            aria-expanded={datePickerOpen}
            className="text-sm font-bold text-white"
          >
            {formatDayLabel(day, today)}
          </button>
          {day !== today ? (
            <button
              type="button"
              onClick={() => setDay(today)}
              className="text-[11px] font-semibold text-gold-light"
            >
              Back to today
            </button>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => canGoForward && setDay(addDays(day, 1))}
          disabled={!canGoForward}
          aria-label="Next day"
          title={!canGoForward ? "You can't log a day that hasn't happened." : undefined}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-sm text-gray transition-colors hover:bg-surface-3 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>

      {datePickerOpen ? (
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-white">
          Jump to a date
          <input
            type="date"
            value={day}
            max={today}
            onChange={(event) => {
              if (isDayKey(event.target.value)) {
                setDay(event.target.value);
                setDatePickerOpen(false);
              }
            }}
            className="min-h-[48px] rounded-md border border-[color:var(--border)] bg-black-soft px-4 text-[15px] text-white"
          />
        </label>
      ) : null}

      {/*
        docs/DESIGN.md §7.3 keeps this chip VISIBLE and disabled when there is nothing to
        copy, rather than hiding it — so the feature stays discoverable. The `title`
        tooltip alone did not carry the reason to assistive tech: a `title` only becomes
        the accessible name when the element has no text content, and this button has
        text, so the "why is this greyed out?" answer was sighted-hover-only. Worse, a
        disabled button is not hoverable or focusable in most browsers, so the tooltip was
        largely unreachable for everyone. The reason now rides on the accessible name, and
        the tooltip stays for the mouse.
      */}
      <button
        type="button"
        onClick={() => setShowCopyConfirm(true)}
        disabled={!canCopySourceDay}
        title={!canCopySourceDay ? NOTHING_TO_COPY : undefined}
        aria-label={
          !canCopySourceDay
            ? `Copy ${formatDayLabel(sourceDay, today).toLowerCase()} — ${NOTHING_TO_COPY}`
            : undefined
        }
        className="flex min-h-[44px] items-center justify-center gap-2 self-start rounded-md border border-[color:var(--border)] bg-surface-2 px-3.5 text-xs font-semibold text-gray transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Copy size={14} aria-hidden="true" />
        Copy {formatDayLabel(sourceDay, today).toLowerCase()}
      </button>

      <section aria-labelledby="log-day-entries" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 id="log-day-entries" className="text-base font-bold text-white">
            Logged for {formatDayLabel(day, today)}
          </h2>
          {dayLog.entries.length > 0 ? (
            <span className="text-xs text-gray tabular-nums">
              {Math.round(sumMacros(dayLog.entries).kcal)} kcal
            </span>
          ) : null}
        </div>

        {dayLog.entries.length > 0 ? (
          <div className="flex flex-col gap-4">
            {MEAL_ORDER.map((slot) => (
              <MealList key={slot} slot={slot} date={day} entries={dayLog.entries} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={UtensilsCrossed}
            title={`Nothing logged for ${formatDayLabel(day, today)}`}
            description="Search the food database, scan a photo, or copy yesterday."
            action={
              <div className="mt-1 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => searchRef.current?.focus()}>
                  Search foods
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!canCopySourceDay}
                  title={!canCopySourceDay ? NOTHING_TO_COPY : undefined}
                  aria-label={!canCopySourceDay ? `Copy yesterday — ${NOTHING_TO_COPY}` : undefined}
                  onClick={() => setShowCopyConfirm(true)}
                >
                  Copy yesterday
                </Button>
              </div>
            }
          />
        )}
      </section>

      <hr className="border-[color:var(--border)]" />

      {/* One persistent live region: it must exist in the DOM before the text changes for
          the announcement to land, and duplicating it would announce twice. */}
      <p
        role="status"
        aria-live="polite"
        className={cn(
          confirmation
            ? 'rounded-md border border-[color:var(--success)]/40 bg-success/10 px-3 py-2.5 text-xs font-medium text-success'
            : 'sr-only',
        )}
      >
        {confirmation}
      </p>

      <div className="relative">
        <Search
          size={18}
          aria-hidden="true"
          className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-gray-soft"
        />
        <label htmlFor="food-search" className="sr-only">
          Search foods
        </label>
        <input
          id="food-search"
          ref={searchRef}
          type="search"
          autoComplete="off"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setConfirmation(null);
          }}
          placeholder="Search chicken, bulgur, ayran…"
          className="min-h-[48px] w-full rounded-md border border-[color:var(--border)] bg-black-soft ps-11 pe-4 text-[15px] text-white placeholder:text-gray-soft focus:border-[color:var(--border-strong)]"
        />
      </div>

      <div className="-mx-4 overflow-x-auto px-4">
        <div className="flex gap-2 pb-1">
          {VIEW_OPTIONS.map((option) => {
            const active = view === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setView(option.value)}
                aria-pressed={active}
                className={cn(
                  'min-h-[44px] shrink-0 whitespace-nowrap rounded-md border px-3.5 text-xs transition-colors',
                  active
                    ? 'border-[color:var(--border-strong)] bg-gold/15 font-bold text-white'
                    : 'border-[color:var(--border)] bg-surface-2 text-gray hover:text-white',
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {view === 'all' ? (
        <div className="-mx-4 overflow-x-auto px-4">
          <div className="flex gap-2 pb-1">
            {(['all', ...CATEGORIES] as const).map((item) => {
              const active = category === item;
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => setCategory(item)}
                  aria-pressed={active}
                  className={cn(
                    'min-h-[44px] shrink-0 whitespace-nowrap rounded-md border px-3.5 text-xs capitalize transition-colors',
                    active
                      ? 'border-[color:var(--border-strong)] bg-gold/15 font-bold text-white'
                      : 'border-[color:var(--border)] bg-surface-2 text-gray hover:text-white',
                  )}
                >
                  {item === 'all' ? 'All' : item}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {resultsSection}

      <p className="mt-2 flex gap-2 text-[11px] leading-relaxed text-gray-soft">
        <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
        {FOOD_DATA_DISCLAIMER}
      </p>

      <Sheet
        open={customFoodSheet !== null}
        onClose={() => setCustomFoodSheet(null)}
        title={customFoodSheet?.initial ? 'Edit custom food' : 'Add a custom food'}
      >
        {customFoodSheet ? (
          <CustomFoodForm
            {...(customFoodSheet.initial ? { initial: customFoodSheet.initial } : {})}
            {...(customFoodSheet.defaultName ? { defaultName: customFoodSheet.defaultName } : {})}
            onSaved={handleCustomFoodSaved}
            onCancel={() => setCustomFoodSheet(null)}
          />
        ) : null}
      </Sheet>

      <Sheet
        open={showCopyConfirm}
        onClose={() => setShowCopyConfirm(false)}
        title={`Copy to ${formatDayLabel(day, today)}`}
      >
        <CopyDayConfirm
          sourceDay={sourceDay}
          today={today}
          entries={sourceDayLog.entries}
          onCancel={() => setShowCopyConfirm(false)}
          onConfirm={handleCopyConfirm}
        />
      </Sheet>
    </div>
  );
}
