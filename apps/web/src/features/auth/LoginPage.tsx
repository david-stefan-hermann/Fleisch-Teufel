import { credentialsSchema } from '@ft/shared';
import { Navigate, useNavigate } from '@tanstack/react-router';
import { LoaderCircle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useSessionContext } from '@/app/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { endpoints, errorMessage } from '@/lib/api';

export function LoginPage() {
  const { session, needsReauth, serverInfo, signIn } = useSessionContext();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState(session?.user.email ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // After a successful submit the page navigates itself (register → onboarding).
  const [done, setDone] = useState(false);

  if (done) return null;
  if (session && !needsReauth) return <Navigate to="/" />;
  const canRegister = serverInfo?.registrationOpen ?? false;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === 'register') {
      const v = credentialsSchema.safeParse({ email, password });
      if (!v.success) {
        setError(
          v.error.issues[0]?.path[0] === 'password'
            ? 'Das Passwort braucht mindestens 8 Zeichen.'
            : 'Bitte gib eine gültige E-Mail-Adresse ein.',
        );
        return;
      }
    }
    setBusy(true);
    try {
      const { user } =
        mode === 'login' ? await endpoints.login(email, password) : await endpoints.register(email, password);
      setDone(true);
      signIn(user);
      await navigate({ to: mode === 'register' ? '/onboarding' : '/' });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6 pt-[var(--safe-top)] pb-[var(--safe-bottom)]">
      <div className="mb-8 flex flex-col items-center gap-3 text-center">
        <img src="/pwa-192x192.png" width={72} height={72} alt="" className="rounded-2xl shadow-sm" />
        <h1 className="text-2xl font-bold tracking-tight" translate="no">
          Fleisch-Teufel
        </h1>
        <p className="text-sm text-muted-foreground text-pretty">
          {needsReauth
            ? 'Melde dich erneut an, um weiter zu synchronisieren.'
            : 'Dein Ernährungstagebuch: offline auf dem Gerät, synchron auf deinem Server.'}
        </p>
      </div>
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <div className="grid gap-1.5">
          <Label htmlFor="email">E-Mail</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            spellCheck={false}
            autoCapitalize="none"
            placeholder="du@example.com…"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password">Passwort</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === 'register' ? 8 : undefined}
          />
          {mode === 'register' && <p className="text-xs text-muted-foreground">Mindestens 8 Zeichen.</p>}
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={busy}>
          {busy && <LoaderCircle className="animate-spin" aria-hidden />}
          {mode === 'login'
            ? busy
              ? 'Anmelden…'
              : 'Anmelden'
            : busy
              ? 'Konto wird erstellt…'
              : 'Konto erstellen'}
        </Button>
        {(canRegister || mode === 'register') && (
          <Button
            type="button"
            variant="link"
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
          >
            {mode === 'login' ? 'Neues Konto erstellen' : 'Ich habe schon ein Konto'}
          </Button>
        )}
      </form>
    </main>
  );
}
