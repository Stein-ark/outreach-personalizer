/**
 * The main view: what was just collected, the current sheet (downloads by itself at 200), an optional message
 * drafted for a whole sheet in one go, and the list of saved emails.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Clock, Copy, Download, FileSpreadsheet, MousePointerClick, Search, Sparkles, Trash2 } from 'lucide-react';
import {
  APP_NAME,
  DEFAULT_DIALS,
  FIELD_LIMITS,
  ProspectStatus,
  SHEET_SIZE,
  SheetDraftRequest,
  type Dials,
  type DraftOutput,
  type Prospect,
  type ProspectFilter,
  type SheetList,
} from '@op/shared';
import { z } from 'zod';
import { api } from '../lib/api';
import { REFRESH_KEY, StoredRefresh } from '../lib/auth';
import { EXPIRY_WARNING_MS, formatLeft, useNow } from '../lib/expiry';
import { LAST_COLLECT_KEY, LastCollect } from '../lib/lastCollect';
import { SHEETS_FOLDER, downloadSheet, downloadedSheets } from '../lib/sheets';
import { getStored, setStored, useStored } from '../lib/storage';
import { Banner, Button, Choice, Field, Spinner } from '../components/ui';
import { ErrorNotice, toShown, type ShownError } from '../components/ErrorNotice';

type StatusFilter = 'all' | ProspectStatus;

const STATUS_LABEL: Record<ProspectStatus, string> = { new: 'Not contacted', drafted: 'Drafted', sent: 'Sent', replied: 'Replied' };

/** The last message the user drafted with, kept on this device so they do not retype it for every sheet. */
const COMPOSER_KEY = 'composer';
const Composer = z.object({ message: z.string(), dials: z.object({ tone: z.enum(['formal', 'warm', 'direct']), length: z.enum(['short', 'medium']) }) });

async function signedInUserId(): Promise<string | null> {
  return (await getStored('local', REFRESH_KEY, StoredRefresh))?.user.id ?? null;
}

/** What the last icon click, menu item or shortcut collected. */
function LastCollectNotice() {
  const last = useStored('session', LAST_COLLECT_KEY, LastCollect);
  const n = last.value;
  if (!n || Date.now() - n.at > 10 * 60_000) return null;
  const page = n.title ? `"${n.title}"` : 'this page';
  const dismiss = <Button size="sm" variant="quiet" onClick={() => void last.update(null)}>Dismiss</Button>;
  switch (n.outcome) {
    case 'saved':
      return <Banner title={`${n.added} new email${n.added === 1 ? '' : 's'} saved`} actions={dismiss}>{n.found} found on {page}{n.found > n.added ? `, ${n.found - n.added} already in your list` : ''}.</Banner>;
    case 'none':
      return <Banner title="No email addresses on this page" actions={dismiss}>Nothing on {page} looked like an email address. Addresses written as "name [at] site" or shown as images can't be read.</Banner>;
    case 'blocked':
      return <Banner tone="warn" title="This site is off limits" actions={dismiss}>LinkedIn does not allow extensions to read its pages, and accounts can be restricted for it, so nothing was collected.</Banner>;
    case 'restricted':
      return <Banner title="Chrome doesn't allow reading this page" actions={dismiss}>Browser pages, the Web Store and PDFs can't be read by extensions.</Banner>;
    case 'signed_out':
      return <Banner tone="warn" title="Found addresses, but couldn't save them" actions={dismiss}>The server didn't accept them. Check that you're signed in and the server is running, then click the icon again.</Banner>;
    default:
      return <Banner tone="error" title="Couldn't read this page" actions={dismiss}>Something on the page blocked it. Reload the page and click the icon again.</Banner>;
  }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [result, setResult] = useState<null | 'copied' | 'failed'>(null);
  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => setResult(null), 2500);
    return () => clearTimeout(t);
  }, [result]);
  return (
    <Button size="sm" icon={result === 'copied' ? Check : Copy} onClick={() => void navigator.clipboard.writeText(text).then(() => setResult('copied'), () => setResult('failed'))} aria-live="polite">
      {result === 'copied' ? 'Copied' : result === 'failed' ? 'Copy failed, select the text instead' : label}
    </Button>
  );
}

/** Optional: one message for a whole sheet, written from what the user wants to say. */
function DraftComposer({ sheets, onDrafted }: { sheets: SheetList; onDrafted: () => void }) {
  const [message, setMessage] = useState('');
  const [dials, setDials] = useState<Dials>(DEFAULT_DIALS);
  const [sheet, setSheet] = useState(sheets.current);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<ShownError | null>(null);
  const [result, setResult] = useState<{ draft: DraftOutput; updated: number; sheet: number } | null>(null);

  useEffect(() => {
    void getStored('local', COMPOSER_KEY, Composer).then((c) => {
      if (c) {
        setMessage(c.message);
        setDials(c.dials);
      }
    });
  }, []);

  const withEmails = sheets.items.filter((s) => s.total > 0);
  const chosen = withEmails.find((s) => s.number === sheet) ?? withEmails[0];

  const draft = async () => {
    if (!chosen) return;
    const parsed = SheetDraftRequest.safeParse({ message, dials });
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? 'Check the message.');
      return;
    }
    setBusy(true);
    setError(null);
    setProblem(null);
    try {
      await setStored('local', COMPOSER_KEY, parsed.data);
      const res = await api.draftSheet(chosen.number, parsed.data);
      setResult({ ...res, sheet: chosen.number });
      onDrafted();
    } catch (err) {
      setError(toShown(err));
    } finally {
      setBusy(false);
    }
  };

  if (!chosen) return null;

  return (
    <section aria-labelledby="compose-heading" className="flex flex-col gap-3 rounded-lg border border-rule bg-surface p-3">
      <div>
        <h2 id="compose-heading" className="flex items-center gap-1.5 font-semibold">
          <Sparkles aria-hidden className="size-4 text-action" />
          Write a message (optional)
        </h2>
        <p className="text-[12px] text-ink-soft">One message for every email in the sheet. It goes into the sheet's draft columns.</p>
      </div>
      <Field
        label="What do you want to say?"
        multiline
        rows={4}
        value={message}
        onChange={(v) => {
          setMessage(v);
          setProblem(null);
        }}
        maxLength={FIELD_LIMITS.message}
        placeholder="I build booking websites for clinics and I'd like to offer a free 20 minute review of their current booking page."
        error={problem}
      />
      <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
        <Choice legend="Tone" value={dials.tone} onChange={(tone) => setDials({ ...dials, tone })} options={[{ value: 'formal', label: 'Formal' }, { value: 'warm', label: 'Friendly' }, { value: 'direct', label: 'Direct' }]} />
        <Choice legend="Length" value={dials.length} onChange={(length) => setDials({ ...dials, length })} options={[{ value: 'short', label: 'Short' }, { value: 'medium', label: 'Medium' }]} />
      </div>
      {withEmails.length > 1 ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="compose-sheet" className="text-[13px] font-medium">For</label>
          <select id="compose-sheet" value={chosen.number} onChange={(e) => setSheet(Number(e.target.value))} className="h-9 rounded-md border border-rule bg-surface px-2">
            {withEmails.map((s) => (
              <option key={s.number} value={s.number}>Sheet {s.number} ({s.total} emails)</option>
            ))}
          </select>
        </div>
      ) : null}
      {error ? <ErrorNotice shown={error} onRetry={() => void draft()} onDismiss={() => setError(null)} /> : null}
      <Button variant="primary" icon={Sparkles} busy={busy} onClick={() => void draft()}>
        {busy ? 'Writing' : `Draft for sheet ${chosen.number} (${chosen.total} email${chosen.total === 1 ? '' : 's'})`}
      </Button>
      {result ? (
        <div className="flex flex-col gap-2 border-t border-rule pt-3">
          <p className="text-[12px] text-ink-soft" role="status">Added to {result.updated} email{result.updated === 1 ? '' : 's'} in sheet {result.sheet}. Download the sheet to get them.</p>
          <article className="animate-settle rounded-lg border border-rule bg-sheet">
            <p className="border-b border-rule px-3 py-2 font-letter text-[15px] font-semibold">{result.draft.subject}</p>
            <p className="px-3 py-3 font-letter text-[15px] leading-relaxed whitespace-pre-line">{result.draft.body}</p>
          </article>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={result.draft.subject} label="Copy subject" />
            <CopyButton text={result.draft.body} label="Copy message" />
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** The sheet being filled (downloads by itself at 200) and the ones already saved to Downloads. */
function SheetsPanel({ list, done, onChanged }: { list: SheetList; done: number[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<ShownError | null>(null);
  const current = list.items.find((s) => s.current);
  const past = list.items.filter((s) => !s.current);

  const download = async (sheet: { number: number; current: boolean }) => {
    setBusy(sheet.number);
    setError(null);
    try {
      const userId = await signedInUserId();
      if (userId) await downloadSheet(sheet, userId);
      onChanged();
    } catch (err) {
      setError(toShown(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="sheets-heading" className="flex flex-col gap-2.5 rounded-lg border border-rule bg-surface p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="sheets-heading" className="flex items-center gap-1.5 font-semibold">
          <FileSpreadsheet aria-hidden className="size-4 text-action" />
          Sheet {list.current}
        </h2>
        <p className="text-[12px] text-ink-soft">{current?.total ?? 0} of {SHEET_SIZE} emails</p>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-paper" role="progressbar" aria-label={`Sheet ${list.current} fill`} aria-valuemin={0} aria-valuemax={SHEET_SIZE} aria-valuenow={current?.total ?? 0}>
        <div className="h-full rounded-full bg-action transition-[width]" style={{ width: `${Math.min(100, ((current?.total ?? 0) / SHEET_SIZE) * 100)}%` }} />
      </div>
      <p className="text-[12px] text-ink-soft">
        {current?.drafted ? `${current.drafted} with a drafted message. ` : ''}Saves itself to Downloads/{SHEETS_FOLDER} at {SHEET_SIZE} emails, then a new sheet starts.
      </p>
      {error ? <ErrorNotice shown={error} onDismiss={() => setError(null)} /> : null}
      {current ? (
        <Button size="sm" icon={Download} busy={busy === current.number} onClick={() => void download(current)} className="self-start">
          Download now and start a new sheet
        </Button>
      ) : null}
      {past.length ? (
        <ul className="flex flex-col gap-1 border-t border-rule pt-2">
          {past.map((s) => (
            <li key={s.number} className="flex items-center justify-between gap-2 text-[13px]">
              <span>
                Sheet {s.number}, {s.total} emails{s.drafted ? `, ${s.drafted} drafted` : ''}{done.includes(s.number) ? ', saved' : ''}
              </span>
              <Button size="sm" variant="quiet" icon={Download} busy={busy === s.number} onClick={() => void download(s)}>
                {done.includes(s.number) ? 'Again' : 'Download'}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Row({ p, now, onChanged, onDeleted }: { p: Prospect; now: number; onChanged: (p: Prospect) => void; onDeleted: (id: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ShownError | null>(null);
  const left = Date.parse(p.expiresAt) - now;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(toShown(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-col gap-1.5 py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{p.email}</p>
          {p.sourceTitle ? <p className="truncate text-[12px] text-ink-soft">{p.sourceTitle}</p> : null}
          <p className={`flex items-center gap-1 text-[12px] ${left < EXPIRY_WARNING_MS ? 'font-medium text-warn' : 'text-ink-soft'}`}>
            <Clock aria-hidden className="size-3" />
            Sheet {p.sheet}, deleted in {formatLeft(left)}
          </p>
        </div>
        <label className="sr-only" htmlFor={`status-${p.id}`}>Status for {p.email}</label>
        <select
          id={`status-${p.id}`}
          value={p.status}
          disabled={busy}
          onChange={(e) => {
            const status = ProspectStatus.parse(e.target.value);
            void run(async () => onChanged(await api.patchProspect(p.id, { status })));
          }}
          className="h-8 rounded-md border border-rule bg-surface px-1.5 text-[13px]"
        >
          {ProspectStatus.options.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        {confirming ? null : (
          <Button size="sm" variant="quiet" icon={Trash2} onClick={() => setConfirming(true)} aria-label={`Delete ${p.email}`} />
        )}
      </div>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px]">Delete this email?</span>
          <Button size="sm" variant="danger" busy={busy} onClick={() => void run(async () => { await api.deleteProspect(p.id); onDeleted(p.id); })}>Delete</Button>
          <Button size="sm" variant="quiet" onClick={() => setConfirming(false)}>Keep</Button>
        </div>
      ) : null}
      {error ? <ErrorNotice shown={error} onDismiss={() => setError(null)} /> : null}
    </li>
  );
}

export default function EmailsView() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [items, setItems] = useState<Prospect[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [sheets, setSheets] = useState<SheetList | null>(null);
  const [done, setDone] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<ShownError | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const now = useNow();
  const lastCollect = useStored('session', LAST_COLLECT_KEY, LastCollect);

  // Debounce typing so search does not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const filter: ProspectFilter = { ...(status !== 'all' ? { status } : {}), ...(query ? { q: query } : {}) };
  const filterKey = JSON.stringify(filter);

  const loadSheets = useCallback(async () => {
    try {
      setSheets(await api.sheets());
      const userId = await signedInUserId();
      if (userId) setDone(await downloadedSheets(userId));
    } catch {
      // The list below shows the error. The sheet card simply waits for the next refresh.
    }
  }, []);

  const load = useCallback(
    async (after: string | null) => {
      const f = JSON.parse(filterKey) as ProspectFilter;
      if (after) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const page = await api.listProspects({ ...f, ...(after ? { cursor: after } : {}) });
        setItems((prev) => (after ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
      } catch (err) {
        setError(toShown(err));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [filterKey],
  );

  const refresh = useCallback(() => {
    void load(null);
    void loadSheets();
  }, [load, loadSheets]);

  useEffect(refresh, [refresh]);
  // New addresses arrive from browsing, so the counts refresh while the panel is open and after every icon click.
  useEffect(() => {
    const t = setInterval(() => void loadSheets(), 10_000);
    return () => clearInterval(t);
  }, [loadSheets]);
  // Refresh after every icon click. The ref keeps the latest refresh without re-running on filter changes.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const lastAt = lastCollect.value?.at;
  useEffect(() => {
    if (lastAt) refreshRef.current();
  }, [lastAt]);

  const exportFile = async () => {
    setExporting(true);
    setError(null);
    try {
      await api.exportProspects(filter);
    } catch (err) {
      setError(toShown(err));
    } finally {
      setExporting(false);
    }
  };

  const filtered = Boolean(query) || status !== 'all';
  const visible = items.filter((p) => Date.parse(p.expiresAt) > now);

  return (
    <div className="flex flex-col gap-3">
      <LastCollectNotice />
      {sheets ? <SheetsPanel list={sheets} done={done} onChanged={refresh} /> : null}
      {sheets ? <DraftComposer sheets={sheets} onDrafted={refresh} /> : null}

      <h2 className="mt-1 font-semibold">Saved emails</h2>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-soft" />
        <label htmlFor="search" className="sr-only">Search saved emails</label>
        <input
          id="search"
          type="search"
          value={q}
          maxLength={FIELD_LIMITS.search}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search emails or pages"
          className="h-9 w-full rounded-md border border-rule bg-surface pr-2.5 pl-8 placeholder:text-ink-soft/70"
        />
      </div>
      <Choice<StatusFilter>
        legend="Status"
        value={status}
        onChange={setStatus}
        options={[{ value: 'all', label: 'All' }, { value: 'new', label: 'New' }, { value: 'drafted', label: 'Drafted' }, { value: 'sent', label: 'Sent' }, { value: 'replied', label: 'Replied' }]}
      />
      {error ? <ErrorNotice shown={error} onRetry={refresh} onDismiss={() => setError(null)} /> : null}

      {loading ? (
        <Spinner label="Loading saved emails" />
      ) : visible.length === 0 ? (
        // When loading failed, the error above explains it. Claiming the list is empty would be wrong.
        error ? null : (
          <div className="flex flex-col gap-2 py-4">
            <p className="font-semibold">{filtered ? 'No emails match' : 'No emails yet'}</p>
            {filtered ? (
              <p className="text-ink-soft">Try another search or status.</p>
            ) : (
              <p className="flex gap-2 text-ink-soft">
                <MousePointerClick aria-hidden className="mt-0.5 size-4 shrink-0 text-ink" />
                <span>Open a page with email addresses and click the {APP_NAME} icon, or turn on automatic collection in Settings.</span>
              </p>
            )}
          </div>
        )
      ) : (
        <>
          <ul aria-label="Saved emails" className="divide-y divide-rule">
            {visible.map((p) => (
              <Row
                key={p.id}
                p={p}
                now={now}
                onChanged={(next) => setItems((list) => (status !== 'all' && next.status !== status ? list.filter((i) => i.id !== next.id) : list.map((i) => (i.id === next.id ? next : i))))}
                onDeleted={(id) => {
                  setItems((list) => list.filter((i) => i.id !== id));
                  void loadSheets();
                }}
              />
            ))}
          </ul>
          {cursor ? <Button busy={loadingMore} onClick={() => void load(cursor)}>Show more</Button> : null}
          <Button icon={Download} busy={exporting} onClick={() => void exportFile()}>
            {exporting ? 'Exporting' : filtered ? 'Export these (.xlsx)' : 'Export all (.xlsx)'}
          </Button>
        </>
      )}

      <div className="mt-4 border-t border-rule pt-4">
        {confirmAll ? (
          <Banner
            tone="error"
            title="Delete every saved email?"
            actions={
              <>
                <Button size="sm" variant="danger" onClick={() => void api.deleteAllProspects().then(() => { setConfirmAll(false); refresh(); }, (err: unknown) => setError(toShown(err)))}>
                  Delete all
                </Button>
                <Button size="sm" variant="quiet" onClick={() => setConfirmAll(false)}>Keep them</Button>
              </>
            }
          >
            This removes all saved emails and drafts from the server. Sheets already in your Downloads folder stay. It can't be undone.
          </Banner>
        ) : (
          <Button size="sm" variant="quiet" icon={Trash2} onClick={() => setConfirmAll(true)}>Delete all saved emails</Button>
        )}
      </div>
    </div>
  );
}
