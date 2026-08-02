import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ScreenHeader } from '@/components/ScreenHeader';
import { AuthErrorBanner } from '@/features/auth/AuthErrorBanner';
import { PasswordField } from '@/features/auth/PasswordField';
import { PasswordStrength } from '@/features/auth/PasswordStrength';
import { RateLimitNotice } from '@/features/auth/RateLimitNotice';
import { useAuth } from '@/features/auth/AuthContext';
import { AuthError, changePassword } from '@/lib/authApi';

/** `/account/password` (docs/DESIGN.md §7.9). */
export function ChangePasswordScreen(): JSX.Element {
  const navigate = useNavigate();
  const auth = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [currentPasswordError, setCurrentPasswordError] = useState<string | undefined>();
  const [error, setError] = useState<AuthError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // 'loading' is not a rejection — the boot probe (GET /api/auth/me) simply hasn't
  // resolved yet. Redirecting on it would bounce a genuinely signed-in user straight
  // back to /account before their own session was ever confirmed.
  if (auth.status === 'loading') {
    return (
      <p role="status" className="p-4 text-sm text-gray">
        Checking your session…
      </p>
    );
  }
  if (auth.status !== 'signed-in') return <Navigate to="/account" replace />;

  const retryAfterSeconds =
    error?.kind === 'rate_limited' && error.retryAfterSeconds !== null ? error.retryAfterSeconds : null;

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setCurrentPasswordError(undefined);
    setSubmitting(true);
    try {
      const user = await changePassword(currentPassword, newPassword);
      auth.signIn(user);
      setDone(true);
    } catch (cause) {
      const authError = cause instanceof AuthError ? cause : new AuthError('server', 'Unexpected failure.');
      if (authError.kind === 'invalid_credentials') {
        setCurrentPasswordError("That's not your current password.");
      } else {
        auth.handleAuthError(authError);
        setError(authError);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <ScreenHeader eyebrow="Account" title="Change password" />

      {done ? (
        <Card className="flex flex-col gap-3">
          <p role="status" className="text-sm text-white">
            Password changed. Every other device has been signed out — you&rsquo;ll need your new
            password there next time.
          </p>
          <Button onClick={() => navigate('/account')}>Back to account</Button>
        </Card>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
          <PasswordField
            label="Current password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            error={currentPasswordError}
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

          {error && retryAfterSeconds === null ? (
            <AuthErrorBanner message="Couldn't change your password. Check your details and try again." />
          ) : null}
          {retryAfterSeconds !== null ? <RateLimitNotice retryAfterSeconds={retryAfterSeconds} /> : null}

          <Button
            type="submit"
            className="w-full"
            disabled={submitting || retryAfterSeconds !== null}
            aria-busy={submitting}
          >
            <KeyRound size={18} aria-hidden="true" />
            {submitting ? 'Changing…' : 'Change password'}
          </Button>
        </form>
      )}
    </div>
  );
}
