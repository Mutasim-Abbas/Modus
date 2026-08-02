import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { AuthErrorBanner } from '@/features/auth/AuthErrorBanner';
import { PasswordField } from '@/features/auth/PasswordField';
import { RateLimitNotice } from '@/features/auth/RateLimitNotice';
import { useAuth } from '@/features/auth/AuthContext';
import { AuthError, login } from '@/lib/authApi';
import { runAdoptionAndNavigate } from '@/features/sync/runAdoptionAndNavigate';

/**
 * `/auth/sign-in` (docs/DESIGN.md §7.9). Sign-in never clears or touches local data —
 * this handler only ever calls `auth.signIn` (in-memory auth state) and navigates; it
 * never imports `src/lib/store.ts` directly. After a successful login it runs the
 * adoption/merge check (`src/lib/sync/signInFlow.ts`) — silent upload/download when
 * only one side has data, `/sync/merge` when both do, straight home when neither does.
 */
export function SignInScreen(): JSX.Element {
  const navigate = useNavigate();
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
      const user = await login(email.trim(), password);
      auth.signIn(user);
      await runAdoptionAndNavigate(navigate, user.id);
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
      case 'invalid_credentials':
        return "That email and password don't match.";
      case 'sync_unconfigured':
        return "Accounts aren't set up on this deployment.";
      default:
        return "We couldn't sign you in. Check your details and try again.";
    }
  };

  return (
    <AuthLayout>
      <div className="mb-5">
        <h1 className="text-xl font-extrabold leading-tight text-white">Sign in</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-gray">
          Welcome back — your log picks up where you left off.
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
        <PasswordField
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        {error && retryAfterSeconds === null ? <AuthErrorBanner message={message()} /> : null}
        {retryAfterSeconds !== null ? <RateLimitNotice retryAfterSeconds={retryAfterSeconds} /> : null}

        <Button
          type="submit"
          className="w-full"
          disabled={submitting || retryAfterSeconds !== null}
          aria-busy={submitting}
        >
          <LogIn size={18} aria-hidden="true" />
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>

        <Link
          to="/auth/recover"
          className="inline-flex min-h-[44px] items-center justify-center rounded-md text-sm font-semibold text-gray transition-colors duration-200 ease-out hover:text-white"
        >
          Use a recovery code
        </Link>
      </form>
    </AuthLayout>
  );
}
