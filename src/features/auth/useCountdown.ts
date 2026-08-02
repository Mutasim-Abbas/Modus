import { useEffect, useState } from 'react';

/** Ticks down from `seconds` to 0, once per second. Resets whenever `seconds` changes. */
export function useCountdown(seconds: number): number {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    setRemaining(seconds);
    if (seconds <= 0) return undefined;

    const id = window.setInterval(() => {
      setRemaining((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [seconds]);

  return remaining;
}

/** `4:32` — minutes:seconds, zero-padded seconds. */
export function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
