/**
 * Panel root: auth gate, the two views (Emails and Settings) and the global offline notice.
 * Both views are lazy loaded so the first paint only ships the sign in check.
 */
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Mail, Settings as SettingsIcon, WifiOff } from 'lucide-react';
import { APP_NAME } from '@op/shared';
import { REFRESH_KEY, StoredRefresh } from './lib/auth';
import { useStored } from './lib/storage';
import { Banner, Spinner } from './components/ui';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SignInView } from './views/SignInView';

const EmailsView = lazy(() => import('./views/EmailsView'));
const SettingsView = lazy(() => import('./views/SettingsView'));

export type Tab = 'emails' | 'settings';

const TABS: { id: Tab; label: string; icon: typeof Mail }[] = [
  { id: 'emails', label: 'Emails', icon: Mail },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

export function App() {
  const auth = useStored('local', REFRESH_KEY, StoredRefresh);
  const [tab, setTab] = useState<Tab>('emails');
  const online = useOnline();
  // Distinguishes "signed out by the user" from "session expired" for the sign in message.
  const wasSignedIn = useRef(false);
  const signedOutOnPurpose = useRef(false);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (auth.value) {
      wasSignedIn.current = true;
      signedOutOnPurpose.current = false;
      setExpired(false);
    } else if (auth.loaded && wasSignedIn.current) {
      setExpired(!signedOutOnPurpose.current);
      wasSignedIn.current = false;
      setTab('emails');
    }
  }, [auth.value, auth.loaded]);

  if (!auth.loaded) return <div className="p-4"><Spinner label="Loading" /></div>;
  if (!auth.value) return <SignInView expired={expired} />;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-rule bg-paper/95 px-3 pt-3 backdrop-blur">
        <p className="mb-2 text-[12px] text-ink-soft">{APP_NAME}</p>
        <nav aria-label="Sections" className="-mb-px flex gap-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-1.5 border-b-2 px-2.5 pb-2 text-[13px] font-medium ${tab === id ? 'border-ink text-ink' : 'border-transparent text-ink-soft hover:text-ink'}`}
            >
              <Icon aria-hidden className="size-4" />
              {label}
            </button>
          ))}
        </nav>
      </header>
      <main className="flex flex-1 flex-col gap-3 p-3">
        {!online ? (
          <Banner tone="warn" title="You're offline">
            <span className="inline-flex items-center gap-1.5"><WifiOff aria-hidden className="size-3.5" /> Saving and drafting wait until you reconnect.</span>
          </Banner>
        ) : null}
        {/* Each section has its own boundary (and the lazy ones their own loader), so one failing leaves the rest usable. */}
        {tab === 'emails' ? (
          <ErrorBoundary section="Emails">
            <Suspense fallback={<Spinner label="Loading" />}>
              <EmailsView />
            </Suspense>
          </ErrorBoundary>
        ) : null}
        {tab === 'settings' ? (
          <ErrorBoundary section="Settings">
            <Suspense fallback={<Spinner label="Loading" />}>
              <SettingsView
                email={auth.value.user.email}
                onSignOut={(intended) => {
                  signedOutOnPurpose.current = intended;
                }}
              />
            </Suspense>
          </ErrorBoundary>
        ) : null}
      </main>
    </div>
  );
}
