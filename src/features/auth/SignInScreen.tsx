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
import { BRAND } from '@/lib/brand';
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
      <div className="mb-7 text-center lg:text-start">
        <h1 className="text-[25px] font-extrabold leading-tight tracking-[-0.03em] text-white lg:text-[28px]">
          Welcome back
        </h1>
        <p className="mx-auto mt-2.5 max-w-[28ch] text-[13.5px] leading-relaxed text-fm-text-faint lg:mx-0 lg:max-w-none">
          Sign in to pick your log up where you left it.
        </p>
      </div>

      <form className="flex flex-col gap-3" onSubmit={(event) => void handleSubmit(event)} noValidate>
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

        {/* The mock's "Forgot password?" — pointed at the recovery-code flow, which is
            the only reset this deployment actually has. Naming it accurately beats
            copying a label that would promise a reset email we never send. */}
        <div className="flex justify-end">
          <Link
            to="/auth/recover"
            className="inline-flex min-h-[40px] items-center rounded-sm px-1 text-[12.5px] font-semibold text-fm-accent transition-colors hover:text-fm-accent-hover"
          >
            Forgot password? Use a recovery code
          </Link>
        </div>

        {error && retryAfterSeconds === null ? <AuthErrorBanner message={message()} /> : null}
        {retryAfterSeconds !== null ? <RateLimitNotice retryAfterSeconds={retryAfterSeconds} /> : null}

        <Button
          type="submit"
          className="min-h-[56px] w-full rounded-md text-[14.5px]"
          disabled={submitting || retryAfterSeconds !== null}
          aria-busy={submitting}
        >
          <LogIn size={18} aria-hidden="true" />
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <div className="mt-6 flex items-center justify-center gap-2">
        <span className="text-[12.5px] text-fm-text-faint">New to {BRAND.name}?</span>
        <Link
          to="/auth/sign-up"
          className="inline-flex min-h-[40px] items-center rounded-sm text-[12.5px] font-bold text-fm-accent transition-colors hover:text-fm-accent-hover"
        >
          Create an account
        </Link>
      </div>
    </AuthLayout>
  );
}
