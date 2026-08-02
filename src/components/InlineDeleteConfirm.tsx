import { Button } from '@/components/Button';

interface InlineDeleteConfirmProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Replaces a row in place to confirm a delete — "no second modal" (docs/DESIGN.md §7.3).
 * Used for entries, custom foods and anywhere else a destructive action needs one more
 * deliberate tap without a native `confirm()` or a stacked dialog.
 */
export function InlineDeleteConfirm({
  message,
  onConfirm,
  onCancel,
}: InlineDeleteConfirmProps): JSX.Element {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-md border border-[color:var(--danger)]/40 bg-danger/10 px-3.5 py-2.5"
    >
      <p className="min-w-0 flex-1 text-xs font-medium leading-relaxed text-danger">{message}</p>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="danger" onClick={onConfirm}>
          Delete
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Keep
        </Button>
      </div>
    </div>
  );
}
