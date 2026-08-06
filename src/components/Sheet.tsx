import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { useAppState } from '@/lib/useStore';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

/**
 * A bottom sheet on phone, a centred dialog from `sm:` up (docs/DESIGN.md §7.3/§8.6).
 *
 * Rendered through a portal so it always sits above the bottom tab bar and the app
 * frame, regardless of where it's mounted in the tree. Honours both the OS
 * `prefers-reduced-motion` setting and the app's own toggle, exactly like `AppShell`.
 */
export function Sheet({ open, onClose, title, children }: SheetProps): JSX.Element | null {
  const { settings } = useAppState();
  const prefersReduced = useReducedMotion();
  const reduce = prefersReduced === true || settings.reducedMotion;
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div key="sheet" className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <motion.div
            className="absolute inset-0 bg-[color:var(--fm-scrim)]"
            onClick={onClose}
            aria-hidden="true"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: reduce ? 1 : 0 }}
            transition={{ duration: reduce ? 0 : 0.18 }}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="relative flex max-h-[88dvh] w-full flex-col overflow-y-auto rounded-t-xl border border-[color:var(--border)] bg-surface-2 p-5 shadow-e3 focus:outline-none sm:max-w-[480px] sm:rounded-lg"
            initial={reduce ? false : { y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 0, opacity: reduce ? 1 : 0 }}
            transition={{ duration: reduce ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
              <h2 id={titleId} className="text-lg font-extrabold leading-tight text-white">
                {title}
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-sm text-gray transition-colors hover:bg-surface-3 hover:text-white"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            {children}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
