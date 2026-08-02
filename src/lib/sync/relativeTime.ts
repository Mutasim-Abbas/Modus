/** "2 min ago" / "3 hours ago" / "just now" — used only by `SyncChip`'s "Synced ·" text. */
export function formatRelativeTime(fromMs: number, nowMs: number = Date.now()): string {
  const diffSeconds = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  if (diffSeconds < 45) return 'just now';
  const minutes = Math.round(diffSeconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
