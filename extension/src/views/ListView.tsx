/**
 * Saved prospects: search, status filter, status change, open into the Prospect view, delete, delete all, export.
 * Pages are loaded with the server cursor ("Show more"), never all at once.
 */
import { useCallback, useEffect, useState } from 'react';
import { Download, FolderOpen, Search, Trash2 } from 'lucide-react';
import { ProspectStatus, type Prospect, type ProspectFilter } from '@op/shared';
import { api } from '../lib/api';
import { getStored, setStored } from '../lib/storage';
import { WORK_KEY, WorkItem } from '../lib/work';
import { Banner, Button, Choice, Spinner } from '../components/ui';
import { ErrorNotice, toShown, type ShownError } from '../components/ErrorNotice';

type StatusFilter = 'all' | ProspectStatus;

const STATUS_LABEL: Record<ProspectStatus, string> = { drafted: 'Drafted', sent: 'Sent', replied: 'Replied' };

function toWork(p: Prospect): WorkItem {
  return {
    id: crypto.randomUUID(),
    tabId: null,
    source: { mode: p.sourceMode, url: p.sourceUrl, title: p.sourceTitle },
    phase: 'drafted',
    fields: { name: p.name, role: p.role, company: p.company, bio: p.bio, detail: p.detail, email: p.email },
    origins: {},
    textTruncated: false,
    confirmed: true,
    dials: { tone: p.tone, length: p.length, goal: p.goal },
    draft: { subject: p.subject, body: p.body, detailUsed: p.detailUsed },
    prospectId: p.id,
    dirty: false,
    staleReason: null,
  };
}

function Row({ p, onChanged, onDeleted, onOpen }: { p: Prospect; onChanged: (p: Prospect) => void; onDeleted: (id: string) => void; onOpen: (p: Prospect) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ShownError | null>(null);
  const title = p.name ?? p.company ?? p.sourceTitle ?? 'Unnamed prospect';
  const sub = [p.role, p.name ? p.company : null].filter(Boolean).join(', ');

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
    <li className="flex flex-col gap-2 py-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{title}</p>
          {sub ? <p className="truncate text-[12px] text-ink-soft">{sub}</p> : null}
          <p className="truncate text-[12px] text-ink-soft">{p.subject}</p>
        </div>
        <label className="sr-only" htmlFor={`status-${p.id}`}>Status for {title}</label>
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
      </div>
      <div className="flex flex-wrap gap-2">
        {confirming ? (
          <>
            <span className="self-center text-[13px]">Delete this prospect?</span>
            <Button size="sm" variant="danger" busy={busy} onClick={() => void run(async () => { await api.deleteProspect(p.id); onDeleted(p.id); })}>Delete</Button>
            <Button size="sm" variant="quiet" onClick={() => setConfirming(false)}>Keep</Button>
          </>
        ) : (
          <>
            <Button size="sm" icon={FolderOpen} onClick={() => onOpen(p)}>Open</Button>
            <Button size="sm" variant="quiet" icon={Trash2} onClick={() => setConfirming(true)} aria-label={`Delete ${title}`}>Delete</Button>
          </>
        )}
      </div>
      {error ? <ErrorNotice shown={error} onDismiss={() => setError(null)} /> : null}
    </li>
  );
}

export default function ListView({ onOpened }: { onOpened: () => void }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [items, setItems] = useState<Prospect[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<ShownError | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [pendingOpen, setPendingOpen] = useState<Prospect | null>(null);

  // Debounce typing so search does not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const filter: ProspectFilter = { ...(status !== 'all' ? { status } : {}), ...(query ? { q: query } : {}) };
  const filterKey = JSON.stringify(filter);

  const load = useCallback(async (after: string | null) => {
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
  }, [filterKey]);

  useEffect(() => {
    void load(null);
  }, [load]);

  const open = async (p: Prospect, force = false) => {
    const current = await getStored('session', WORK_KEY, WorkItem);
    if (current?.dirty && !force) {
      setPendingOpen(p);
      return;
    }
    try {
      await setStored('session', WORK_KEY, toWork(await api.getProspect(p.id)));
      onOpened();
    } catch (err) {
      setError(toShown(err));
    }
  };

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

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-soft" />
        <label htmlFor="search" className="sr-only">Search saved prospects</label>
        <input
          id="search"
          type="search"
          value={q}
          maxLength={100}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, company, role or email"
          className="h-9 w-full rounded-md border border-rule bg-surface pr-2.5 pl-8 placeholder:text-ink-soft/70"
        />
      </div>
      <Choice<StatusFilter>
        legend="Status"
        value={status}
        onChange={setStatus}
        options={[{ value: 'all', label: 'All' }, { value: 'drafted', label: 'Drafted' }, { value: 'sent', label: 'Sent' }, { value: 'replied', label: 'Replied' }]}
      />
      <Button icon={Download} busy={exporting} disabled={loading || items.length === 0} onClick={() => void exportFile()}>
        {exporting ? 'Exporting' : filtered ? 'Export these (.xlsx)' : 'Export all (.xlsx)'}
      </Button>

      {pendingOpen ? (
        <Banner
          tone="warn"
          title="Your current draft has unsaved changes"
          actions={
            <>
              <Button size="sm" onClick={() => { const p = pendingOpen; setPendingOpen(null); void open(p, true); }}>Open anyway</Button>
              <Button size="sm" variant="quiet" onClick={() => setPendingOpen(null)}>Cancel</Button>
            </>
          }
        >
          Opening another prospect replaces it. Go back to the Prospect tab and save first if you want to keep the edits.
        </Banner>
      ) : null}
      {error ? <ErrorNotice shown={error} onRetry={() => void load(null)} onDismiss={() => setError(null)} /> : null}

      {loading ? (
        <Spinner label="Loading saved prospects" />
      ) : items.length === 0 ? (
        <div className="py-6">
          <p className="font-semibold">{filtered ? 'No prospects match' : 'No saved prospects yet'}</p>
          <p className="mt-1 text-ink-soft">
            {filtered ? 'Try another search or status.' : 'Every email you draft is saved here, ready to track and export.'}
          </p>
        </div>
      ) : (
        <>
          <ul aria-label="Saved prospects" className="divide-y divide-rule">
            {items.map((p) => (
              <Row
                key={p.id}
                p={p}
                onOpen={(x) => void open(x)}
                onChanged={(next) => setItems((list) => (status !== 'all' && next.status !== status ? list.filter((i) => i.id !== next.id) : list.map((i) => (i.id === next.id ? next : i))))}
                onDeleted={(id) => setItems((list) => list.filter((i) => i.id !== id))}
              />
            ))}
          </ul>
          {cursor ? <Button busy={loadingMore} onClick={() => void load(cursor)}>Show more</Button> : null}
        </>
      )}

      <div className="mt-4 border-t border-rule pt-4">
        {confirmAll ? (
          <Banner
            tone="error"
            title="Delete every saved prospect?"
            actions={
              <>
                <Button size="sm" variant="danger" onClick={() => void api.deleteAllProspects().then(() => { setConfirmAll(false); setItems([]); setCursor(null); }, (err: unknown) => setError(toShown(err)))}>
                  Delete all
                </Button>
                <Button size="sm" variant="quiet" onClick={() => setConfirmAll(false)}>Keep them</Button>
              </>
            }
          >
            This removes all prospects and drafts from the server. It can't be undone.
          </Banner>
        ) : (
          <Button size="sm" variant="quiet" icon={Trash2} onClick={() => setConfirmAll(true)}>Delete all prospects</Button>
        )}
      </div>
    </div>
  );
}
