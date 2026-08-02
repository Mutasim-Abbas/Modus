import { useEffect, useSyncExternalStore } from 'react';
import { CheckCircle2, X, XCircle } from 'lucide-react';
import { dismissToast, getToasts, subscribeToasts } from '@/lib/toast';
import { cn } from '@/lib/cn';

/**
 * The app-wide toast host (docs/DESIGN.md §8.7). Mounted once, in `<AppShell>` — every
 * screen inside the app shares this one instance. `role="status"` for a success toast,
 * `role="alert"` for a failure, auto-dismissing after 5s each (§9's "Success" pattern).
 */
export function ToastHost(): JSX.Element {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getToasts);

  return (
    <div
      className="pointer-events-none fixed inset-x-4 bottom-[88px] z-50 flex flex-col items-center gap-2 lg:inset-x-auto lg:bottom-6 lg:end-6 lg:items-end"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} id={toast.id} message={toast.message} tone={toast.tone} />
      ))}
    </div>
  );
}

function ToastItem({ id, message, tone }: { id: string; message: string; tone: 'success' | 'error' }): JSX.Element {
  useEffect(() => {
    const timer = setTimeout(() => dismissToast(id), 5000);
    return () => clearTimeout(timer);
  }, [id]);

  return (
    <div
      role={tone === 'success' ? 'status' : 'alert'}
      className={cn(
        'pointer-events-auto flex w-full max-w-[400px] items-start gap-2 rounded-md border p-4 shadow-e2',
        'bg-surface-2 border-[color:var(--border-strong)]',
      )}
    >
      {tone === 'success' ? (
        <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-fm-ok" aria-hidden="true" />
      ) : (
        <XCircle size={18} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
      )}
      <p className="flex-1 text-sm leading-relaxed text-white">{message}</p>
      <button
        type="button"
        onClick={() => dismissToast(id)}
        aria-label="Dismiss"
        className="grid h-6 w-6 shrink-0 place-items-center rounded-xs text-gray-soft hover:text-white"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
