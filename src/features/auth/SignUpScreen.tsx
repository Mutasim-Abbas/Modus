import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { AlertTriangle, UserPlus } from 'lucide-react';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { LinkButton } from '@/components/LinkButton';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { AuthErrorBanner } from '@/features/auth/AuthErrorBanner';
import { PasswordField } from '@/features/auth/PasswordField';
import { PasswordStrength } from '@/features/auth/PasswordStrength';
import { RateLimitNotice } from '@/features/auth/RateLimitNotice';
import { useAuth } from '@/features/auth/AuthContext';
import { AuthError, signup } from '@/lib/authApi';

/**
 * `/auth/sign-up` (docs/DESIGN.md §7.9). Guest mode is never blocked: this screen always
 * offers "Continue without an account" (via `AuthLayout`), and nothing downstream of it
 * requires a profile — a brand-new account still walks through onboarding afterward.
 */
export function SignUpScreen(): JSX.Element {
  const navigate = useNavigate();
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState<AuthError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (auth.status === 'signed-in') return <Navigate to="/account" replace />;

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    const nextFieldError: { email?: string; password?: string } = {};
    if (!trimmedEmail) nextFieldError.email = 'Enter your email.';
    if (password.length < 8) nextFieldError.password = 'At least 8 characters.';
    setFieldError(nextFieldError);
    if (nextFieldError.email || nextFieldError.password) return;

    setSubmitting(true);
    try {
      const result = await signup(trimmedEmail, password);
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

  const retryAfterSeconds =
    error?.kind === 'rate_limited' && error.retryAfterSeconds !== null ? error.retryAfterSeconds : null;

  return (
    <AuthLayout>
      <div className="mb-6 text-center lg:text-start">
        <h1 className="text-[25px] font-extrabold leading-tight tracking-[-0.03em] text-white lg:text-[28px]">
          Create your account
        </h1>
        <p className="mx-auto mt-2.5 max-w-[28ch] text-[13.5px] leading-relaxed text-fm-text-faint lg:mx-0 lg:max-w-none">
          Your log syncs across your devices. Nothing is shared.
        </p>
      </div>

      <div
        role="alert"
        className="mb-4 flex items-start gap-2 rounded-md border border-fm-warn/40 bg-fm-warn-bg px-3 py-3"
      >
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-fm-warn" aria-hidden="true" />
        <p className="flex-1 text-xs leading-relaxed text-white">
          We can&rsquo;t email you a reset link. You&rsquo;ll get a recovery code on the next
          screen. Save it.
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
          error={fieldError.email}
          hint={fieldError.email ? undefined : 'Used only to sign in. Not verified, and we never send email.'}
        />

        <div className="flex flex-col gap-2">
          <PasswordField
            label="Password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={fieldError.password}
            hint={fieldError.password ? undefined : 'At least 8 characters.'}
          />
          <PasswordStrength password={password} />
        </div>

        {error && retryAfterSeconds === null ? (
          <AuthErrorBanner
            message={
              error.kind === 'email_taken'
                ? 'That email already has an account.'
                : error.kind === 'sync_unconfigured'
                  ? "Accounts aren't set up on this deployment."
                  : 'We couldn’t create that account. Check your details and try again.'
            }
          />
        ) : null}
        {error?.kind === 'email_taken' ? (
          <LinkButton to="/auth/sign-in" variant="secondary" className="w-full">
            Sign in instead
          </LinkButton>
        ) : null}
        {retryAfterSeconds !== null ? <RateLimitNotice retryAfterSeconds={retryAfterSeconds} /> : null}

        <Button
          type="submit"
          className="min-h-[56px] w-full rounded-md text-[14.5px]"
          disabled={submitting || retryAfterSeconds !== null}
          aria-busy={submitting}
        >
          <UserPlus size={18} aria-hidden="true" />
          {submitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>

      <div className="mt-6 flex items-center justify-center gap-2">
        <span className="text-[12.5px] text-fm-text-faint">Already have an account?</span>
        <Link
          to="/auth/sign-in"
          className="inline-flex min-h-[40px] items-center rounded-sm text-[12.5px] font-bold text-fm-accent transition-colors hover:text-fm-accent-hover"
        >
          Sign in
        </Link>
      </div>
    </AuthLayout>
  );
}
