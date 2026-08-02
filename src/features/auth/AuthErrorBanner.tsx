import { AlertTriangle } from 'lucide-react';

/** The generic inline form-level error card used across every auth screen. */
export function AuthErrorBanner({ message }: { message: string }): JSX.Element {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-[color:var(--danger)]/40 bg-danger/10 px-3 py-3"
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
      <p className="flex-1 text-xs leading-relaxed text-white">{message}</p>
    </div>
  );
}
