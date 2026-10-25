/**
 * Panel root: auth gate, the three main views and the global offline notice.
 * List and Settings are lazy loaded so the first paint only ships the Prospect view.
 */
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { List, PenLine, Settings as SettingsIcon, WifiOff } from 'lucide-react';
import { APP_NAME } from '@op/shared';
import { REFRESH_KEY, StoredRefresh } from './lib/auth';
import { useStored } from './lib/storage';
import { Banner, Spinner } from './components/ui';
import { SignInView } from './views/SignInView';
import { ProspectView } from './views/ProspectView';

const ListView = lazy(() => import('./views/ListView'));
const SettingsView = lazy(() => import('./views/SettingsView'));

export type Tab = 'prospect' | 'list' | 'settings';

const TABS: { id: Tab; label: string; icon: typeof List }[] = [
  { id: 'prospect', label: 'Prospect', icon: PenLine },
  { id: 'list', label: 'Saved', icon: List },
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
  const [tab, setTab] = useState<Tab>('prospect');
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
      setTab('prospect');
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
            <span className="inline-flex items-center gap-1.5"><WifiOff aria-hidden className="size-3.5" /> Reading pages still works. Extracting, drafting and saving wait until you reconnect.</span>
          </Banner>
        ) : null}
        {tab === 'prospect' ? <ProspectView onOpenSettings={() => setTab('settings')} /> : null}
        <Suspense fallback={<Spinner label="Loading" />}>
          {tab === 'list' ? <ListView onOpened={() => setTab('prospect')} /> : null}
          {tab === 'settings' ? (
            <SettingsView
              email={auth.value.user.email}
              onSignOut={(intended) => {
                signedOutOnPurpose.current = intended;
              }}
            />
          ) : null}
        </Suspense>
      </main>
    </div>
  );
}
