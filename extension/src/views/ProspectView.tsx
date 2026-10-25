/**
 * The main view: what was read, the editable extracted fields, the dials, and the draft shown as a letter
 * with the detail it relies on pinned in the margin.
 */
import { useEffect, useState } from 'react';
import {
  Check,
  ClipboardPaste,
  Copy,
  FileText,
  Globe,
  MousePointerClick,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  TextSelect,
} from 'lucide-react';
import { APP_NAME, FIELD_KEYS, FIELD_LIMITS, PAGE_TEXT_CAP, isSenderProfileComplete, type FieldKey, type Settings } from '@op/shared';
import { api } from '../lib/api';
import { emailMatchesName } from '../lib/deterministic';
import { EXPIRY_WARNING_MS, formatClock, formatLeft, useNow } from '../lib/expiry';
import { useProspectFlow, type ReadNotice } from '../lib/useProspectFlow';
import type { WorkItem } from '../lib/work';
import { Banner, Button, Choice, Field, Spinner } from '../components/ui';
import { ErrorNotice } from '../components/ErrorNotice';

const LABELS: Record<FieldKey, string> = {
  name: 'Name',
  role: 'Role',
  company: 'Company',
  bio: 'Short bio',
  detail: 'Notable detail',
  email: 'Email',
};

function OriginTag({ origin }: { origin: string | undefined }) {
  if (origin === 'page') return <span className="text-[12px] text-ink-soft">From the page</span>;
  if (origin === 'ai') return <span className="text-[12px] text-warn">Suggested by AI, check it</span>;
  return null;
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function ReadNoticeBanner({ notice, onReread, onDismiss }: { notice: ReadNotice; onReread: () => void; onDismiss: () => void }) {
  const dismiss = <Button size="sm" variant="quiet" onClick={onDismiss}>Dismiss</Button>;
  switch (notice.reason) {
    case 'blocked':
      return (
        <Banner tone="warn" title={`Page reading is off on ${hostOf(notice.url) ?? 'this site'}`} actions={dismiss}>
          This site does not allow extensions to read its pages, and accounts can be restricted for it. Select the text you want
          to use, right click and choose "Draft outreach from selected text", or paste it below.
        </Banner>
      );
    case 'restricted':
      return (
        <Banner tone="info" title="Chrome doesn't allow reading this page" actions={dismiss}>
          Browser pages, the Chrome Web Store and the PDF viewer can't be read by extensions. Paste the text below instead.
        </Banner>
      );
    case 'empty':
      return (
        <Banner tone="info" title="Nothing readable here" actions={dismiss}>
          This page has no text to work with. Select text on it and use the right click menu, or paste text below.
        </Banner>
      );
    case 'no_access':
      return (
        <Banner tone="warn" title="Click the extension icon on the page first" actions={dismiss}>
          Chrome only lets {APP_NAME} read a page right after you click its toolbar icon (or press Alt+Shift+O) on that page. The
          button in this panel can re-read only until the page changes.
        </Banner>
      );
    default:
      return (
        <Banner tone="error" title="Couldn't read this page" actions={<><Button size="sm" icon={RefreshCw} onClick={onReread}>Try again</Button>{dismiss}</>}>
          Something on the page blocked reading. Try again, or paste the text below.
        </Banner>
      );
  }
}

function PasteBox({ onSubmit, busy }: { onSubmit: (text: string) => void; busy: boolean }) {
  const [text, setText] = useState('');
  return (
    <section aria-labelledby="paste-heading" className="flex flex-col gap-2 rounded-lg border border-rule bg-surface p-3">
      <h2 id="paste-heading" className="font-semibold">Paste text instead</h2>
      <Field
        label="Text about the prospect"
        multiline
        rows={5}
        value={text}
        onChange={setText}
        maxLength={PAGE_TEXT_CAP}
        hint={`${text.length.toLocaleString()} of ${PAGE_TEXT_CAP.toLocaleString()} characters.`}
      />
      <Button icon={ClipboardPaste} busy={busy} disabled={text.trim().length < 20} onClick={() => onSubmit(text)} className="self-start">
        Read pasted text
      </Button>
    </section>
  );
}

function EmptyState() {
  return (
    <section className="flex flex-col gap-3 py-2">
      <h2 className="text-[18px] font-semibold tracking-tight">Open a prospect's page to start</h2>
      <ul className="flex flex-col gap-2.5 text-ink-soft">
        <li className="flex gap-2">
          <MousePointerClick aria-hidden className="mt-0.5 size-4 shrink-0 text-ink" />
          <span>Click the {APP_NAME} icon in the toolbar, or press Alt+Shift+O, while the page is open.</span>
        </li>
        <li className="flex gap-2">
          <TextSelect aria-hidden className="mt-0.5 size-4 shrink-0 text-ink" />
          <span>Or select text, right click, and choose "Draft outreach from selected text".</span>
        </li>
      </ul>
      <p className="text-[12px] text-ink-soft">
        Only the page you choose is read, and only when you ask. Its text is sent to your {APP_NAME} server and to Groq (the AI
        provider) to pull out details and write the draft. Nothing is read in the background.
      </p>
    </section>
  );
}

function SourceLine({ work, onNew, onReread, rereading }: { work: WorkItem; onNew: () => void; onReread: () => void; rereading: boolean }) {
  const Icon = work.source.mode === 'paste' ? ClipboardPaste : work.source.mode === 'selection' ? TextSelect : Globe;
  const label = work.source.mode === 'paste' ? 'Pasted text' : work.source.title || hostOf(work.source.url) || 'This page';
  return (
    <div className="flex items-center gap-2">
      <Icon aria-hidden className="size-4 shrink-0 text-ink-soft" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" title={label}>{label}</p>
        {work.source.url ? <p className="truncate text-[12px] text-ink-soft">{hostOf(work.source.url)}{work.source.mode === 'selection' ? ', selected text' : ''}</p> : null}
      </div>
      <div className="flex shrink-0 gap-1">
        {work.source.mode !== 'paste' ? (
          <Button size="sm" variant="quiet" icon={RefreshCw} busy={rereading} onClick={onReread} aria-label="Re-read page">
            Re-read
          </Button>
        ) : null}
        <Button size="sm" variant="quiet" icon={Plus} onClick={onNew}>New</Button>
      </div>
    </div>
  );
}

/** Unsaved, saved until a time, or no longer saved. Saved prospects are deleted by the server after a few hours. */
function SavedStatus({ dirty, expiresAt, saved }: { dirty: boolean; expiresAt: string | null; saved: boolean }) {
  const now = useNow();
  const left = expiresAt ? Date.parse(expiresAt) - now : null;
  if (!saved) return <p className="text-[12px] font-medium text-warn" aria-live="polite">Not saved to your list</p>;
  let text = dirty ? 'Unsaved changes' : 'Saved to your list';
  if (left !== null && left <= 0) text = 'No longer saved. Draft again to save it';
  else if (left !== null && !dirty) text = `Saved until ${formatClock(expiresAt!)}`;
  const urgent = left !== null && left < EXPIRY_WARNING_MS;
  return (
    <p className={`text-[12px] ${urgent ? 'font-medium text-warn' : 'text-ink-soft'}`} aria-live="polite" title={left !== null && left > 0 ? `Deleted in ${formatLeft(left)}. Export from the Saved tab to keep it.` : undefined}>
      {text}
    </p>
  );
}

/** Every address on the page as a one click choice, the likely match for the name first. */
function EmailChoices({ choices, current, name, onPick, disabled }: { choices: string[]; current: string | null; name: string | null; onPick: (e: string) => void; disabled: boolean }) {
  if (choices.length === 0 || (choices.length === 1 && choices[0] === current)) return null;
  const sorted = [...choices].sort((a, b) => Number(emailMatchesName(b, name)) - Number(emailMatchesName(a, name)));
  return (
    <div className="-mt-1 flex flex-col gap-1.5">
      <p className="text-[12px] text-ink-soft">
        {choices.length} address{choices.length === 1 ? '' : 'es'} on this page. Choose the one for this person:
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {sorted.map((e) => (
          <li key={e}>
            <button
              type="button"
              disabled={disabled}
              aria-pressed={e === current}
              onClick={() => onPick(e)}
              className={`max-w-full truncate rounded-full border px-2.5 py-1 text-[12px] ${e === current ? 'border-action bg-action-soft text-ink' : 'border-rule bg-surface text-ink-soft hover:text-ink'}`}
            >
              {e}
              {emailMatchesName(e, name) ? <span className="ml-1 text-action">likely match</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [result, setResult] = useState<null | 'copied' | 'failed'>(null);
  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => setResult(null), 2500);
    return () => clearTimeout(t);
  }, [result]);
  return (
    <Button
      size="sm"
      icon={result === 'copied' ? Check : Copy}
      onClick={() => void navigator.clipboard.writeText(text).then(() => setResult('copied'), () => setResult('failed'))}
      aria-live="polite"
    >
      {result === 'copied' ? 'Copied' : result === 'failed' ? 'Copy failed, select the text instead' : label}
    </Button>
  );
}

export function ProspectView({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    // Defaults only. If this fails the flow still works with built in dial defaults.
    void api.getSettings().then(setSettings, () => undefined);
  }, []);
  const flow = useProspectFlow(settings?.defaultDials ?? null);
  const w = flow.work;

  if (!flow.loaded) return <Spinner label="Loading" />;

  const profileIncomplete = settings !== null && !isSenderProfileComplete(settings.sender);
  const extracting = w?.phase === 'extracting';
  const drafting = w?.phase === 'drafting';

  return (
    <div className="flex flex-col gap-4">
      {flow.notice ? <ReadNoticeBanner notice={flow.notice} onReread={() => void flow.reread()} onDismiss={flow.dismissNotice} /> : null}

      {w?.staleReason ? (
        <Banner
          tone="warn"
          title={w.staleReason === 'navigated' ? 'This page has changed' : 'You switched to another tab'}
          actions={
            <>
              <Button size="sm" icon={RefreshCw} busy={flow.busy === 'reading'} onClick={() => void flow.reread()}>Read the current page</Button>
              <Button size="sm" variant="quiet" onClick={flow.keepStale}>Keep working on this one</Button>
            </>
          }
        >
          The details below came from {w.source.title ? `"${w.source.title}"` : 'the previous page'}. Drafting is paused until you choose.
        </Banner>
      ) : null}

      {flow.error ? (
        <ErrorNotice
          shown={flow.error}
          onDismiss={flow.dismissError}
          onOpenSettings={onOpenSettings}
          onRetry={w?.phase === 'review' && flow.canRetryExtract ? flow.retryExtract : w?.confirmed ? () => void flow.generate() : undefined}
        />
      ) : null}

      {!w ? (
        <>
          <EmptyState />
          <PasteBox onSubmit={(t) => void flow.fromPaste(t)} busy={false} />
        </>
      ) : (
        <>
          <SourceLine work={w} onNew={() => void flow.clear()} onReread={() => void flow.reread()} rereading={flow.busy === 'reading'} />

          {w.phase === 'interrupted' ? (
            <Banner tone="info" title="Reading was interrupted" actions={<Button size="sm" icon={RefreshCw} onClick={() => void flow.reread()}>Re-read page</Button>}>
              The panel closed before the details were filled in. Re-read the page, or fill in the fields yourself.
            </Banner>
          ) : null}

          <section aria-labelledby="details-heading" className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <h2 id="details-heading" className="font-semibold">Prospect details</h2>
              {extracting ? <Spinner label="Reading details" /> : null}
            </div>
            {w.textTruncated ? (
              <p className="text-[12px] text-ink-soft">Long page: only the first {PAGE_TEXT_CAP.toLocaleString()} characters were used.</p>
            ) : null}
            {FIELD_KEYS.map((key) => (
              <div key={key} className="flex flex-col gap-2">
                <Field
                  label={LABELS[key]}
                  value={w.fields[key] ?? ''}
                  onChange={(v) => flow.setField(key, v)}
                  multiline={key === 'bio' || key === 'detail'}
                  rows={key === 'bio' ? 3 : 2}
                  type={key === 'email' ? 'email' : 'text'}
                  maxLength={FIELD_LIMITS[key]}
                  disabled={extracting || drafting}
                  tag={<OriginTag origin={w.origins[key]} />}
                  error={flow.fieldErrors[key] ?? null}
                  hint={key === 'detail' ? 'The opener is built on this. Make sure it is true and specific.' : key === 'email' ? 'Only addresses that appear on the page.' : undefined}
                />
                {key === 'email' ? (
                  <EmailChoices choices={w.emailChoices} current={w.fields.email} name={w.fields.name} onPick={(e) => flow.setField('email', e)} disabled={extracting || drafting} />
                ) : null}
              </div>
            ))}
            {!w.confirmed ? (
              <Button variant="primary" icon={Check} disabled={extracting} onClick={flow.confirm} className="self-start">
                These details are right
              </Button>
            ) : null}
          </section>

          {w.confirmed ? (
            <section aria-labelledby="dials-heading" className="flex flex-col gap-3 border-t border-rule pt-4">
              <h2 id="dials-heading" className="font-semibold">How it should read</h2>
              <Choice legend="Tone" value={w.dials.tone} onChange={(tone) => flow.setDials({ ...w.dials, tone })} options={[{ value: 'formal', label: 'Formal' }, { value: 'warm', label: 'Warm' }, { value: 'direct', label: 'Direct' }]} />
              <Choice legend="Length" value={w.dials.length} onChange={(length) => flow.setDials({ ...w.dials, length })} options={[{ value: 'short', label: 'Short' }, { value: 'medium', label: 'Medium' }]} />
              <Choice legend="Goal" value={w.dials.goal} onChange={(goal) => flow.setDials({ ...w.dials, goal })} options={[{ value: 'book_call', label: 'Book a call' }, { value: 'introduce_service', label: 'Introduce' }, { value: 'ask_intro', label: 'Ask for intro' }]} />
              {profileIncomplete ? (
                <Banner tone="warn" title="Add your sender profile first" actions={<Button size="sm" onClick={onOpenSettings}>Open settings</Button>}>
                  The draft needs your name, organisation and what you are raising for or offering. Nothing about you is invented.
                </Banner>
              ) : null}
              <Button
                variant="primary"
                icon={Sparkles}
                busy={drafting}
                disabled={profileIncomplete || w.staleReason !== null}
                onClick={() => void flow.generate()}
              >
                {drafting ? 'Drafting' : w.draft ? 'Draft again' : 'Draft email'}
              </Button>
            </section>
          ) : null}

          {w.draft ? (
            <section aria-labelledby="draft-heading" className="flex flex-col gap-3 border-t border-rule pt-4">
              <div className="flex items-baseline justify-between">
                <h2 id="draft-heading" className="font-semibold">Draft</h2>
                <SavedStatus dirty={w.dirty} expiresAt={w.expiresAt} saved={w.prospectId !== null} />
              </div>
              {w.prospectId === null ? (
                <Banner tone="warn" title="Draft ready, but not saved">
                  The server couldn't reach its database, so this draft isn't in your list. Copy it now, or use Draft again later to
                  save it.
                </Banner>
              ) : null}
              <article key={flow.savedAt ?? 0} className={`${flow.savedAt && Date.now() - flow.savedAt < 1000 ? 'animate-settle ' : ''}rounded-lg border border-rule bg-sheet shadow-[0_1px_0_var(--rule)]`}>
                <div className="border-b border-rule px-3 py-2">
                  <label htmlFor="draft-subject" className="text-[12px] text-ink-soft">Subject</label>
                  <input
                    id="draft-subject"
                    value={w.draft.subject}
                    maxLength={FIELD_LIMITS.subject}
                    onChange={(e) => flow.editDraft({ subject: e.target.value })}
                    className="w-full bg-transparent font-letter text-[15px] font-semibold text-ink"
                  />
                </div>
                <label htmlFor="draft-body" className="sr-only">Email body</label>
                <textarea
                  id="draft-body"
                  value={w.draft.body}
                  maxLength={FIELD_LIMITS.body}
                  rows={12}
                  onChange={(e) => flow.editDraft({ body: e.target.value })}
                  className="block w-full resize-y bg-transparent px-3 py-3 font-letter text-[15px] leading-relaxed text-ink"
                />
              </article>
              <aside className="flex gap-2 border-l-2 border-action pl-2.5">
                <FileText aria-hidden className="mt-0.5 size-4 shrink-0 text-action" />
                <p className="text-[13px]">
                  <span className="text-ink-soft">The opening relies on: </span>
                  <span className="font-medium">{w.draft.detailUsed}</span>
                  <span className="block text-[12px] text-ink-soft">Check this against the page before you send.</span>
                </p>
              </aside>
              <div className="flex flex-wrap gap-2">
                <CopyButton text={w.draft.subject} label="Copy subject" />
                <CopyButton text={w.draft.body} label="Copy body" />
                {w.prospectId !== null ? (
                  <Button size="sm" variant={w.dirty ? 'primary' : 'secondary'} icon={Save} busy={flow.busy === 'saving'} disabled={!w.dirty} onClick={() => void flow.save()}>
                    Save changes
                  </Button>
                ) : null}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
