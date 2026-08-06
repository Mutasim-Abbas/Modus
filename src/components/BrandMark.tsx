import { useState } from 'react';
import { cn } from '@/lib/cn';

interface BrandMarkProps {
  size?: number;
  className?: string;
}

/** Where the raster mark lives once it is saved into `public/`. */
const MARK_SRC = '/modus-mark.png';

/**
 * The Modus mark.
 *
 * Prefers the real artwork at `public/modus-mark.png`. If that file is absent the <img>
 * fails and this falls back to a drawn monogram — an "M" inside an open ring gauge, so
 * the logo echoes the calorie ring on Today. The fallback means the app never shows a
 * broken-image icon, and dropping the PNG in later needs no code change.
 */
export function BrandMark({ size = 46, className }: BrandMarkProps): JSX.Element {
  const [rasterFailed, setRasterFailed] = useState(false);

  if (!rasterFailed) {
    return (
      <img
        src={MARK_SRC}
        alt="Modus"
        width={size}
        height={size}
        onError={() => setRasterFailed(true)}
        className={cn('block shrink-0 rounded-[0.32em] object-cover shadow-accent', className)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label="Modus"
      className={cn('block shrink-0 rounded-[0.32em] shadow-accent', className)}
    >
      <defs>
        <linearGradient id="modus-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--fm-violet-300)" />
          <stop offset="100%" stopColor="var(--fm-violet-600)" />
        </linearGradient>
        <linearGradient id="modus-arc" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--fm-cyan-400)" />
          <stop offset="100%" stopColor="var(--fm-violet-100)" />
        </linearGradient>
      </defs>

      <rect width="48" height="48" rx="15" fill="url(#modus-tile)" />

      {/* The gauge: an open ring, mirroring the calorie ring on Today. */}
      <circle cx="24" cy="24" r="14" fill="none" stroke="rgba(255,255,255,.22)" strokeWidth="3.5" />
      <circle
        cx="24"
        cy="24"
        r="14"
        fill="none"
        stroke="url(#modus-arc)"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray="66 88"
        transform="rotate(-90 24 24)"
      />

      {/* The M, set to read inside the ring rather than fill the tile. */}
      <path
        d="M17.4 30.2V18.6l6.6 7.4 6.6-7.4v11.6"
        fill="none"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
