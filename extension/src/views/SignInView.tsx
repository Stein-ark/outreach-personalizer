/** Sign in and create account. Signup may be closed on the server, which is explained when it happens. */
import { useState, type FormEvent } from 'react';
import { LogIn, UserPlus } from 'lucide-react';
import { APP_NAME, Credentials } from '@op/shared';
import { api } from '../lib/api';
import { ApiError } from '../lib/http';
import { Banner, Button, Field } from '../components/ui';
import { ErrorNotice, toShown, type ShownError } from '../components/ErrorNotice';

export function SignInView({ expired }: { expired: boolean }) {
  const [mode, setMode] = useState<'signin' | 'register'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<ShownError | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setFailure(null);
    if (mode === 'register') {
      const parsed = Credentials.safeParse({ email, password });
      if (!parsed.success) {
        setMessage(parsed.error.issues[0]?.message ?? 'Check your email and password.');
        return;
      }
    }
    setBusy(true);
    try {
      if (mode === 'register') await api.register({ email, password });
      else await api.login({ email, password });
    } catch (err) {
      if (err instanceof ApiError && ['INVALID_CREDENTIALS', 'SIGNUP_DISABLED', 'EMAIL_TAKEN', 'VALIDATION'].includes(err.code)) {
        setMessage(err.code === 'SIGNUP_DISABLED' ? 'Sign up is closed on this server. Ask the owner for an account.' : err.message);
      } else {
        setFailure(toShown(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-5 p-4">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">{APP_NAME}</h1>
        <p className="mt-1 text-ink-soft">Collect email addresses from the pages you visit into ready made spreadsheets.</p>
      </div>
      {expired ? <Banner tone="warn" title="Your session expired">Sign in again to continue. Your current prospect is still here.</Banner> : null}
      {failure ? <ErrorNotice shown={failure} onDismiss={() => setFailure(null)} /> : null}
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          hint={mode === 'register' ? 'At least 10 characters.' : undefined}
        />
        {message ? <p role="alert" className="text-[13px] text-danger">{message}</p> : null}
        <Button type="submit" variant="primary" busy={busy} icon={mode === 'register' ? UserPlus : LogIn}>
          {mode === 'register' ? 'Create account' : 'Sign in'}
        </Button>
      </form>
      <Button variant="quiet" onClick={() => { setMode(mode === 'signin' ? 'register' : 'signin'); setMessage(null); }}>
        {mode === 'signin' ? 'New here? Create an account' : 'Have an account? Sign in'}
      </Button>
    </main>
  );
}
