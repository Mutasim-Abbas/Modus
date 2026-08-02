import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { AuthErrorBanner } from '@/features/auth/AuthErrorBanner';
import { PasswordField } from '@/features/auth/PasswordField';
import { PasswordStrength } from '@/features/auth/PasswordStrength';
import { RateLimitNotice } from '@/features/auth/RateLimitNotice';
import { useAuth } from '@/features/auth/AuthContext';
import { AuthError, recoveryRedeem } from '@/lib/authApi';

/** Uppercases and groups into 4-char blocks as the user types, for legibility only —
 *  the server accepts the code case-insensitively and with or without dashes either way. */
function formatRecoveryCodeInput(raw: string): string {
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 20);
  return cleaned.match(/.{1,4}/g)?.join('-') ?? cleaned;
}

/**
 * `/auth/recover` (docs/DESIGN.md §7.9) — redeems a one-time recovery code for a new
 * password. There is no separate "forgot password" email flow in v3 (docs/API.md,
 * "Account recovery — no email in v3"): this IS the recovery mechanism.
 */
export function RecoverScreen(): JSX.Element {
  const navigate = useNavigate();
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<AuthError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (auth.status === 'signed-in') return <Navigate to="/account" replace />;

  const retryAfterSeconds =
    error?.kind === 'rate_limited' && error.retryAfterSeconds !== null ? error.retryAfterSeconds : null;

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await recoveryRedeem(email.trim(), recoveryCode, newPassword);
      auth.signIn(result.user);
      navigate('/auth/recovery-code', {
        replace: true,
        state: { recoveryCode: result.recoveryCode, email: result.user.email },
      });
    } catch (cause) {
      const authError = cause instanceof AuthError ? cause : new AuthError('server', 'Unexpected failure.');
      auth.handleAuthError(authError);
      setError(authError);
    } finally {
      setSubmitting(false);
    }
  };

  const message = (): string => {
    if (!error) return '';
    switch (error.kind) {
      case 'recovery_invalid':
        return "That email and recovery code don't match.";
      case 'sync_unconfigured':
        return "Accounts aren't set up on this deployment.";
      default:
        return "We couldn't reset your password. Check your details and try again.";
    }
  };

  return (
    <AuthLayout>
      <div className="mb-5">
        <h1 className="text-xl font-extrabold leading-tight text-white">Use your recovery code</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-gray">
          Using this code signs you out everywhere and gives you a new code.
        </p>
      </div>

      <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <Field
          label="Recovery code"
          inputMode="text"
          autoComplete="one-time-code"
          className="font-mono tracking-[0.06em]"
          value={recoveryCode}
          onChange={(event) => setRecoveryCode(formatRecoveryCodeInput(event.target.value))}
        />

        <div className="flex flex-col gap-2">
          <PasswordField
            label="New password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            hint="At least 8 characters."
          />
          <PasswordStrength password={newPassword} />
        </div>

        {error && retryAfterSeconds === null ? <AuthErrorBanner message={message()} /> : null}
        {retryAfterSeconds !== null ? <RateLimitNotice retryAfterSeconds={retryAfterSeconds} /> : null}

        <Button
          type="submit"
          className="w-full"
          disabled={submitting || retryAfterSeconds !== null}
          aria-busy={submitting}
        >
          <KeyRound size={18} aria-hidden="true" />
          {submitting ? 'Resetting…' : 'Reset password'}
        </Button>
      </form>
    </AuthLayout>
  );
}
