/**
 * Settings: sender profile, voice samples, default dials, footer, privacy notes and account actions.
 */
import { useEffect, useState } from 'react';
import { LogOut, Radar, Save, UserX } from 'lucide-react';
import { APP_NAME, FIELD_LIMITS, Settings } from '@op/shared';
import { api } from '../lib/api';
import { removeStored, useStored } from '../lib/storage';
import { AUTO_KEY, AutoSetting, disableAutoCollect, enableAutoCollect } from '../lib/autoCollect';
import { LAST_COLLECT_KEY } from '../lib/lastCollect';
import { Banner, Button, Field, Spinner } from '../components/ui';
import { ErrorNotice, toShown, type ShownError } from '../components/ErrorNotice';

function AboutYouSection() {
  const [form, setForm] = useState<{ name: string; link: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<ShownError | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const fill = (s: Settings) => setForm({ name: s.sender.name ?? '', link: s.sender.link ?? '' });
  const load = () => {
    setError(null);
    api.getSettings().then(fill, (err: unknown) => setError(toShown(err)));
  };
  useEffect(load, []);

  if (!form) return error ? <ErrorNotice shown={error} onRetry={load} /> : <Spinner label="Loading settings" />;

  const set = (key: keyof typeof form, value: string) => {
    setSaved(false);
    setErrors((e) => ({ ...e, [key]: '' }));
    setForm({ ...form, [key]: value });
  };

  const save = async () => {
    const parsed = Settings.safeParse({ sender: form });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[i.path.length - 1]), i.path.includes('link') ? 'Use a full link starting with https://' : i.message])));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      fill(await api.putSettings(parsed.data));
      setSaved(true);
    } catch (err) {
      setError(toShown(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="about-heading" className="flex flex-col gap-3">
      <div>
        <h2 id="about-heading" className="font-semibold">You</h2>
        <p className="text-[13px] text-ink-soft">Only used when you draft a message: it is signed with your name.</p>
      </div>
      <Field label="Your name" value={form.name} onChange={(v) => set('name', v)} maxLength={FIELD_LIMITS.name} autoComplete="name" error={errors.name} />
      <Field label="Your link (optional)" type="url" value={form.link} onChange={(v) => set('link', v)} placeholder="https://" hint="The only link a message may include." error={errors.link} />
      {error ? <ErrorNotice shown={error} onRetry={() => void save()} onDismiss={() => setError(null)} /> : null}
      <div className="flex items-center gap-3">
        <Button variant="primary" icon={Save} busy={saving} onClick={() => void save()}>Save</Button>
        {saved ? <p role="status" className="text-[13px] text-ink-soft">Saved</p> : null}
      </div>
    </section>
  );
}

function AutoCollectSection() {
  const setting = useStored('local', AUTO_KEY, AutoSetting);
  const on = setting.value?.enabled === true;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const toggle = async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (on) await disableAutoCollect();
      else if (!(await enableAutoCollect())) setMessage('Chrome did not grant access to websites, so collection stays off.');
    } catch (err) {
      // Chrome's own reason (for example a permission or registration error) is shown so problems can be diagnosed.
      setMessage(`Could not change the setting: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="auto-heading" className="flex flex-col gap-3 border-t border-rule pt-4">
      <div>
        <h2 id="auto-heading" className="font-semibold">Automatic collection</h2>
        <p className="text-[13px] text-ink-soft">
          {on ? 'On. ' : 'Off. '}When on, every page you open is scanned for email addresses, and they are saved into
          spreadsheets of 200 in your Downloads folder by themselves. You just keep browsing. Only the addresses and the page's
          address and title are sent to your server, never the page itself. With it off, click the icon on a page to collect it.
        </p>
      </div>
      <p className="text-[13px] text-ink-soft">
        It never runs on LinkedIn, webmail, Google Docs and Drive, payment sites, private network addresses, or any page with a
        password or card field. The toolbar icon shows how many people each page had.
      </p>
      {!on ? (
        <Banner tone="warn" title="Check the rules where you and your contacts are">
          Collecting addresses for cold email is regulated in many places, for example GDPR and PECR in the EU and UK and
          CAN-SPAM in the US. Chrome will ask to let {APP_NAME} read data on all websites.
        </Banner>
      ) : null}
      <Button variant={on ? 'secondary' : 'primary'} icon={Radar} busy={busy} onClick={() => void toggle()} className="self-start">
        {on ? 'Turn off automatic collection' : 'Turn on automatic collection'}
      </Button>
      {message ? <p role="alert" className="text-[13px] text-danger">{message}</p> : null}
    </section>
  );
}

function AccountSection({ email, onSignOut }: { email: string; onSignOut: (intended: boolean) => void }) {
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const signOut = async () => {
    onSignOut(true);
    await disableAutoCollect().catch(() => undefined);
    await removeStored('session', LAST_COLLECT_KEY);
    await api.logout();
  };

  const deleteAccount = async () => {
    setBusy(true);
    setMessage(null);
    try {
      onSignOut(true);
      await api.deleteAccount(password);
      await disableAutoCollect().catch(() => undefined);
      await removeStored('session', LAST_COLLECT_KEY);
    } catch (err) {
      onSignOut(false);
      setMessage(err instanceof Error ? err.message : 'Could not delete the account.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="account-heading" className="flex flex-col gap-3 border-t border-rule pt-4">
      <h2 id="account-heading" className="font-semibold">Account and privacy</h2>
      <p className="text-[13px] text-ink-soft">Signed in as {email}.</p>
      <p className="text-[13px] text-ink-soft">
        {APP_NAME} looks for email addresses on a page when you click its icon, its menu item or its shortcut, and, if you
        turn on automatic collection, on every page you open. Only the addresses and the page's address and title are saved.
        When you draft, what you typed is sent to Groq to write the message. Saved emails are deleted from the server a few hours
        after they are saved, once their sheet is in your Downloads folder. There are no analytics or trackers.
      </p>
      <Button icon={LogOut} onClick={() => void signOut()} className="self-start">Sign out</Button>
      {deleting ? (
        <Banner tone="error" title="Delete your account and all data?">
          <div className="flex flex-col gap-2">
            <p>This deletes your account, settings and every saved prospect. It can't be undone.</p>
            <Field label="Confirm with your password" type="password" value={password} onChange={setPassword} autoComplete="current-password" error={message} />
            <div className="flex gap-2">
              <Button size="sm" variant="danger" icon={UserX} busy={busy} disabled={!password} onClick={() => void deleteAccount()}>Delete account</Button>
              <Button size="sm" variant="quiet" onClick={() => setDeleting(false)}>Cancel</Button>
            </div>
          </div>
        </Banner>
      ) : (
        <Button variant="quiet" icon={UserX} onClick={() => setDeleting(true)} className="self-start">Delete account</Button>
      )}
    </section>
  );
}

export default function SettingsView({ email, onSignOut }: { email: string; onSignOut: (intended: boolean) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <AboutYouSection />
      <AutoCollectSection />
      <AccountSection email={email} onSignOut={onSignOut} />
      {/* Which build is running, so a forgotten extension reload is easy to spot. */}
      <p className="text-[12px] text-ink-soft">Build {new Date(__BUILD_TIME__).toLocaleString()}</p>
    </div>
  );
}

