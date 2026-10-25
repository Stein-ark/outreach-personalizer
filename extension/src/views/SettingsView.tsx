/**
 * Settings: sender profile, voice samples, default dials, footer, privacy notes and account actions.
 */
import { useEffect, useState } from 'react';
import { LogOut, Plus, Radar, Save, Trash2, UserX } from 'lucide-react';
import {
  APP_NAME,
  FIELD_LIMITS,
  Settings,
  VOICE_SAMPLE_MAX_CHARS,
  VOICE_SAMPLE_MAX_COUNT,
  VoiceSampleCreate,
  type VoiceSample,
} from '@op/shared';
import { api } from '../lib/api';
import { removeStored, useStored } from '../lib/storage';
import { AUTO_KEY, AutoSetting, disableAutoCollect, enableAutoCollect } from '../lib/autoCollect';
import { WORK_KEY } from '../lib/work';
import { Banner, Button, Choice, Field, Spinner } from '../components/ui';
import { ErrorNotice, toShown, type ShownError } from '../components/ErrorNotice';

interface Form {
  name: string;
  role: string;
  organisation: string;
  offer: string;
  link: string;
  footer: string;
  dials: Settings['defaultDials'];
}

const toForm = (s: Settings): Form => ({
  name: s.sender.name ?? '',
  role: s.sender.role ?? '',
  organisation: s.sender.organisation ?? '',
  offer: s.sender.offer ?? '',
  link: s.sender.link ?? '',
  footer: s.footer ?? '',
  dials: s.defaultDials,
});

function SenderSection() {
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<ShownError | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = () => {
    setError(null);
    api.getSettings().then((s) => setForm(toForm(s)), (err: unknown) => setError(toShown(err)));
  };
  useEffect(load, []);

  if (!form) return error ? <ErrorNotice shown={error} onRetry={load} /> : <Spinner label="Loading settings" />;

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setSaved(false);
    setErrors((e) => ({ ...e, [key]: '' }));
    setForm({ ...form, [key]: value });
  };

  const save = async () => {
    const parsed = Settings.safeParse({
      sender: { name: form.name, role: form.role, organisation: form.organisation, offer: form.offer, link: form.link },
      defaultDials: form.dials,
      footer: form.footer,
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[i.path.length - 1]), i.path.includes('link') ? 'Use a full link starting with https://' : i.message])));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      setForm(toForm(await api.putSettings(parsed.data)));
      setSaved(true);
    } catch (err) {
      setError(toShown(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="sender-heading" className="flex flex-col gap-3">
      <div>
        <h2 id="sender-heading" className="font-semibold">You, the sender</h2>
        <p className="text-[13px] text-ink-soft">Drafts only say what is written here about you. Name, organisation and offer are required.</p>
      </div>
      <Field label="Your name" value={form.name} onChange={(v) => set('name', v)} maxLength={FIELD_LIMITS.name} autoComplete="name" error={errors.name} />
      <Field label="Your role" value={form.role} onChange={(v) => set('role', v)} maxLength={FIELD_LIMITS.role} placeholder="Founder and CEO" />
      <Field label="Organisation" value={form.organisation} onChange={(v) => set('organisation', v)} maxLength={FIELD_LIMITS.company} autoComplete="organization" error={errors.organisation} />
      <Field
        label="What you are raising for or offering"
        multiline
        rows={3}
        value={form.offer}
        onChange={(v) => set('offer', v)}
        maxLength={FIELD_LIMITS.senderOffer}
        hint="One or two sentences. Include traction only if it is true, the draft repeats it."
        error={errors.offer}
      />
      <Field label="Your link (optional)" type="url" value={form.link} onChange={(v) => set('link', v)} placeholder="https://" hint="The only link a draft may contain." error={errors.link} />

      <h3 className="mt-2 font-semibold">Default settings for new drafts</h3>
      <Choice legend="Tone" value={form.dials.tone} onChange={(tone) => set('dials', { ...form.dials, tone })} options={[{ value: 'formal', label: 'Formal' }, { value: 'warm', label: 'Warm' }, { value: 'direct', label: 'Direct' }]} />
      <Choice legend="Length" value={form.dials.length} onChange={(length) => set('dials', { ...form.dials, length })} options={[{ value: 'short', label: 'Short' }, { value: 'medium', label: 'Medium' }]} />
      <Choice legend="Goal" value={form.dials.goal} onChange={(goal) => set('dials', { ...form.dials, goal })} options={[{ value: 'book_call', label: 'Book a call' }, { value: 'introduce_service', label: 'Introduce' }, { value: 'ask_intro', label: 'Ask for intro' }]} />
      <Field
        label="Footer (optional)"
        multiline
        rows={2}
        value={form.footer}
        onChange={(v) => set('footer', v)}
        maxLength={FIELD_LIMITS.footer}
        hint="Added after every draft, for example an opt-out line. The AI never sees or changes it."
      />
      {error ? <ErrorNotice shown={error} onRetry={() => void save()} onDismiss={() => setError(null)} /> : null}
      <div className="flex items-center gap-3">
        <Button variant="primary" icon={Save} busy={saving} onClick={() => void save()}>Save settings</Button>
        {saved ? <p role="status" className="text-[13px] text-ink-soft">Saved</p> : null}
      </div>
    </section>
  );
}

function VoiceSection() {
  const [samples, setSamples] = useState<VoiceSample[] | null>(null);
  const [text, setText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<ShownError | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError(null);
    api.listVoiceSamples().then(setSamples, (err: unknown) => setError(toShown(err)));
  };
  useEffect(load, []);

  const add = async () => {
    const parsed = VoiceSampleCreate.safeParse({ text });
    if (!parsed.success) {
      setMessage(parsed.error.issues[0]?.message ?? 'Check the sample.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await api.addVoiceSample(parsed.data.text);
      setSamples((s) => [...(s ?? []), created]);
      setText('');
      setMessage(null);
    } catch (err) {
      setError(toShown(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.deleteVoiceSample(id);
      setSamples((s) => (s ?? []).filter((x) => x.id !== id));
    } catch (err) {
      setError(toShown(err));
    }
  };

  const full = (samples?.length ?? 0) >= VOICE_SAMPLE_MAX_COUNT;

  return (
    <section aria-labelledby="voice-heading" className="flex flex-col gap-3 border-t border-rule pt-4">
      <div>
        <h2 id="voice-heading" className="font-semibold">Your writing voice</h2>
        <p className="text-[13px] text-ink-soft">
          Up to {VOICE_SAMPLE_MAX_COUNT} emails you wrote. Drafts copy their length, phrasing and tone, never their facts.
        </p>
      </div>
      <Banner tone="info" title="Remove other people's details first">
        Delete recipients' names, email addresses, phone numbers and anything private before you paste a sample.
      </Banner>
      {error ? <ErrorNotice shown={error} onRetry={load} onDismiss={() => setError(null)} /> : null}
      {samples === null ? (
        error ? null : <Spinner label="Loading samples" />
      ) : (
        <ul className="flex flex-col gap-2">
          {samples.map((s, i) => (
            <li key={s.id} className="flex items-start gap-2 rounded-md border border-rule bg-surface p-2.5">
              <p className="line-clamp-3 flex-1 text-[13px] whitespace-pre-line">{s.text}</p>
              <Button size="sm" variant="quiet" icon={Trash2} onClick={() => void remove(s.id)} aria-label={`Remove sample ${i + 1}`}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
      {!full ? (
        <>
          <Field
            label="Add a sample"
            multiline
            rows={5}
            value={text}
            onChange={(v) => {
              setText(v);
              setMessage(null);
            }}
            maxLength={VOICE_SAMPLE_MAX_CHARS}
            hint={`${text.length.toLocaleString()} of ${VOICE_SAMPLE_MAX_CHARS.toLocaleString()} characters.`}
            error={message}
          />
          <Button icon={Plus} busy={busy} disabled={!text.trim()} onClick={() => void add()} className="self-start">Add sample</Button>
        </>
      ) : (
        <p className="text-[13px] text-ink-soft">You have {VOICE_SAMPLE_MAX_COUNT} samples. Remove one to add another.</p>
      )}
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
          {on ? 'On. ' : 'Off. '}When on, every page you open is scanned for email addresses and the names next to them, and each
          person is added to your Saved list as "Not contacted" (kept for a few hours, like everything else). Only names and
          addresses are sent to your server. Page text is not sent, and the AI is not used until you draft.
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
    await removeStored('session', WORK_KEY);
    await api.logout();
  };

  const deleteAccount = async () => {
    setBusy(true);
    setMessage(null);
    try {
      onSignOut(true);
      await api.deleteAccount(password);
      await disableAutoCollect().catch(() => undefined);
      await removeStored('session', WORK_KEY);
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
        {APP_NAME} reads a page only when you click its icon, its menu items or its shortcut. The page's text is sent to your
        server and to Groq to extract details and draft the email. Only the details and drafts you save are stored, never the page
        text, and saved prospects are deleted from the server a few hours after they are saved, so export your list to keep it.
        There are no analytics or trackers.
      </p>
      <Button icon={LogOut} onClick={() => void signOut()} className="self-start">Sign out</Button>
      {deleting ? (
        <Banner tone="error" title="Delete your account and all data?">
          <div className="flex flex-col gap-2">
            <p>This deletes your account, settings, voice samples and every saved prospect. It can't be undone.</p>
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
      <SenderSection />
      <AutoCollectSection />
      <VoiceSection />
      <AccountSection email={email} onSignOut={onSignOut} />
    </div>
  );
}

