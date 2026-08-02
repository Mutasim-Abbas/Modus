import { formatCountdown, useCountdown } from '@/features/auth/useCountdown';

interface RateLimitNoticeProps {
  retryAfterSeconds: number;
}

/**
 * docs/DESIGN.md §7.9: "the button disables and shows 'Too many attempts. Try again in
 * 4:32.' with a live countdown and aria-live='polite'."
 */
export function RateLimitNotice({ retryAfterSeconds }: RateLimitNoticeProps): JSX.Element {
  const remaining = useCountdown(retryAfterSeconds);

  return (
    <p role="status" aria-live="polite" className="text-xs font-medium text-fm-warn">
      {remaining > 0
        ? `Too many attempts. Try again in ${formatCountdown(remaining)}.`
        : 'You can try again now.'}
    </p>
  );
}
