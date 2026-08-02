import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera, Loader2, Upload } from 'lucide-react';
import type { AnalyzedItem, MealSlot } from '@/types';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { LinkButton } from '@/components/LinkButton';
import { ScreenHeader } from '@/components/ScreenHeader';
import {
  AnalyzeError,
  MAX_IMAGE_BYTES,
  analyzeErrorMessage,
  analyzeMeal,
  fileToDataUrl,
  parseDataUrl,
} from '@/lib/api';
import { toDayKey } from '@/lib/date';
import { useStore } from '@/lib/useStore';
import { ScanReview } from '@/features/scan/ScanReview';
import { suggestMeal } from '@/features/log/meals';
import {
  getScanAvailability,
  getUnavailableReason,
  markScanAvailable,
  markScanUnavailable,
} from '@/features/scan/availability';

type Status =
  | { phase: 'idle' }
  | { phase: 'analyzing' }
  | { phase: 'review'; items: AnalyzedItem[]; note: string }
  | { phase: 'error'; error: AnalyzeError };

/**
 * Photo -> AI estimate -> editable review -> logged.
 *
 * Nothing here ever invents a number. If the endpoint is missing or unconfigured, the
 * feature disables itself and says so plainly; the rest of the app is unaffected.
 */
export function ScanScreen(): JSX.Element {
  const store = useStore();
  // If an earlier attempt this session proved the feature isn't configured, say so up
  // front rather than letting the user pick a photo that can only fail.
  const [status, setStatus] = useState<Status>(() => {
    if (getScanAvailability() === 'unavailable') {
      return {
        phase: 'error',
        error: new AnalyzeError(
          'ai_unconfigured',
          getUnavailableReason() ?? 'AI scanning is not configured on this deployment.',
        ),
      };
    }
    return { phase: 'idle' };
  });
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const handleFile = useCallback(async (file: File): Promise<void> => {
    if (file.size > MAX_IMAGE_BYTES) {
      setStatus({
        phase: 'error',
        error: new AnalyzeError('too_large', 'Image exceeds the 5 MB limit.'),
      });
      return;
    }

    setStatus({ phase: 'analyzing' });
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const dataUrl = await fileToDataUrl(file);
      const parsed = parseDataUrl(dataUrl);
      if (!parsed) {
        setStatus({
          phase: 'error',
          error: new AnalyzeError('invalid_input', 'Unsupported image format.'),
        });
        return;
      }

      setPreview(dataUrl);

      const result = await analyzeMeal({
        imageBase64: parsed.base64,
        mediaType: parsed.mediaType,
        signal: controller.signal,
      });

      if (result.items.length === 0) {
        setStatus({
          phase: 'error',
          error: new AnalyzeError(
            'malformed_response',
            'The model could not identify any food in that photo.',
          ),
        });
        return;
      }

      markScanAvailable();
      setStatus({ phase: 'review', items: result.items, note: result.note });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;

      const analyzeError =
        error instanceof AnalyzeError
          ? error
          : new AnalyzeError('server', 'Unexpected failure during analysis.');

      markScanUnavailable(analyzeError, analyzeErrorMessage(analyzeError));
      setStatus({ phase: 'error', error: analyzeError });
    }
  }, []);

  const reset = (): void => {
    setPreview(null);
    if (fileRef.current) fileRef.current.value = '';
    // Don't re-offer the uploader if we already know the feature isn't configured.
    if (getScanAvailability() === 'unavailable') return;
    setStatus({ phase: 'idle' });
  };

  const handleLog = (items: AnalyzedItem[], meal: MealSlot): void => {
    for (const item of items) {
      store.addEntry(
        {
          name: item.name,
          grams: item.grams,
          kcal: item.kcal,
          protein: item.protein,
          carbs: item.carbs,
          fat: item.fat,
          meal,
          source: 'scan',
        },
        toDayKey(),
      );
    }
    reset();
  };

  if (status.phase === 'review') {
    return (
      <ScanReview
        items={status.items}
        note={status.note}
        preview={preview}
        defaultMeal={suggestMeal()}
        onCancel={reset}
        onLog={handleLog}
      />
    );
  }

  const unavailable = status.phase === 'error' && status.error.isFeatureUnavailable;

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        eyebrow="Scan"
        title="Estimate a meal from a photo"
        subtitle="An AI model looks at your photo and estimates the macros. You review and edit every number before anything is logged."
      />

      {unavailable ? (
        <Card className="flex flex-col gap-3 border-[color:var(--border-strong)]">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-gold" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-bold text-white">Scanning isn’t available here</h2>
              <p className="mt-1.5 text-xs leading-relaxed text-gray">
                {analyzeErrorMessage(status.error)}
              </p>
            </div>
          </div>
          <LinkButton to="/log" variant="secondary" className="w-full">
            Log from the food database
          </LinkButton>
        </Card>
      ) : (
        <>
          <Card className="flex flex-col items-center gap-4 py-8 text-center">
            {preview && status.phase === 'analyzing' ? (
              <img
                src={preview}
                alt="The meal you are analysing"
                className="max-h-48 w-full rounded-md object-cover"
              />
            ) : (
              <span className="grid h-14 w-14 place-items-center rounded-md bg-surface-2 text-gold">
                <Camera size={24} aria-hidden="true" />
              </span>
            )}

            {status.phase === 'analyzing' ? (
              <p className="flex items-center gap-2 text-sm text-gray" role="status">
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                Analysing your photo…
              </p>
            ) : (
              <p className="max-w-[34ch] text-sm leading-relaxed text-gray">
                Take or upload a photo of your meal. JPEG, PNG or WebP, under 5 MB.
              </p>
            )}

            <label className="w-full">
              <span className="sr-only">Choose a meal photo</span>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={status.phase === 'analyzing'}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleFile(file);
                }}
                className="block w-full text-sm text-gray file:me-3 file:min-h-[48px] file:cursor-pointer file:rounded-md file:border-0 file:bg-gold-mark file:px-5 file:font-bold file:text-black hover:file:brightness-110 disabled:opacity-50"
              />
            </label>
          </Card>

          {status.phase === 'error' ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-[color:var(--danger)]/40 bg-danger/10 px-3 py-3"
            >
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
              <div className="flex-1">
                <p className="text-xs leading-relaxed text-white">
                  {analyzeErrorMessage(status.error)}
                </p>
                <Button size="sm" variant="ghost" className="mt-1 px-0" onClick={reset}>
                  Try another photo
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}

      <div className="flex gap-2 rounded-md border border-[color:var(--border)] bg-surface-2/50 px-3 py-3">
        <Upload size={14} className="mt-0.5 shrink-0 text-gray-soft" aria-hidden="true" />
        <p className="text-[11px] leading-relaxed text-gray-soft">
          Your photo is sent to the server only to be analysed, and is not stored by FitMacro.
          AI estimates are rough — always check the numbers before logging them.
        </p>
      </div>
    </div>
  );
}
