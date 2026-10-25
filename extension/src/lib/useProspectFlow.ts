/**
 * State machine for the Prospect view: read result, extract, confirm fields, draft, edit, save.
 *
 * Durable state lives in chrome.storage.session (the work item), so closing the panel loses nothing.
 * The raw page text is held only in memory (a ref) while extraction runs and for a retry, and is never stored.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_DIALS,
  EMPTY_FIELDS,
  FIELD_KEYS,
  PAGE_TEXT_CAP,
  ProspectFields,
  type Dials,
  type ExtractRequest,
  type FieldKey,
  type PageSnapshot,
  type SourceMode,
} from '@op/shared';
import { api } from './api';
import { emailChoicesFrom, hintsFromSnapshot } from './deterministic';
import { readTab, type ReadResult } from './reader';
import { getStored, removeStored, setStored, useStored } from './storage';
import { PENDING_READ_KEY, PendingRead, WORK_KEY, WorkItem, type LooseFields } from './work';
import { toShown, type ShownError } from '../components/ErrorNotice';

export type ReadNotice = Extract<ReadResult, { ok: false }>;
export type FieldErrors = Partial<Record<FieldKey, string>>;

const newId = () => crypto.randomUUID();

/**
 * The panel running an AI step for a work item holds this Web Lock until the step ends. Chrome releases it if the
 * panel closes, so any panel (another window, or this one reopened) can tell a running step from an abandoned one.
 */
const workLock = (id: string) => `op-work-${id}`;

/** Reads, changes and writes the work item, but only if it is still the same item (guards against late async results). */
async function mutateWork(id: string, fn: (w: WorkItem) => WorkItem): Promise<void> {
  const current = await getStored('session', WORK_KEY, WorkItem);
  if (!current || current.id !== id) return;
  await setStored('session', WORK_KEY, fn(current));
}

function toRequest(mode: SourceMode, s: PageSnapshot, hints: ProspectFields): ExtractRequest {
  const url = mode !== 'paste' && /^https?:\/\//.test(s.url) ? s.url : null;
  return { mode, url, title: mode === 'paste' ? null : s.title || null, text: s.text, hints, mailtos: s.mailtos };
}

/** Pasted text goes through the same pipeline as a page read, as a snapshot with only text. */
function snapshotFromText(text: string): PageSnapshot {
  const trimmed = text.trim();
  return {
    url: '',
    title: '',
    description: null,
    og: { title: null, description: null, siteName: null, type: null },
    jsonLd: [],
    headings: [],
    mailtos: [],
    text: trimmed.slice(0, PAGE_TEXT_CAP),
    textTruncated: trimmed.length > PAGE_TEXT_CAP,
  };
}

export function useProspectFlow(defaultDials: Dials | null) {
  const work = useStored('session', WORK_KEY, WorkItem);
  const pending = useStored('session', PENDING_READ_KEY, PendingRead);
  const [notice, setNotice] = useState<ReadNotice | null>(null);
  const [error, setError] = useState<ShownError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState<null | 'reading' | 'saving'>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const lastExtract = useRef<{ workId: string; request: ExtractRequest } | null>(null);

  /** Runs extraction under the work lock. `create` is stored first, inside the lock, for a brand new item. */
  const runExtract = useCallback(
    (workId: string, request: ExtractRequest, create?: WorkItem) =>
      navigator.locks.request(workLock(workId), async () => {
        lastExtract.current = { workId, request };
        setError(null);
        if (create) await work.update(create);
        else await mutateWork(workId, (w) => ({ ...w, phase: 'extracting' }));
        try {
          const res = await api.extract(request);
          await mutateWork(workId, (w) => ({ ...w, phase: 'review', fields: res.fields, origins: res.origins }));
          lastExtract.current = null;
        } catch (err) {
          // The page level fields found locally stay, so the user can still fill the rest by hand.
          await mutateWork(workId, (w) => ({ ...w, phase: 'review' }));
          setError(toShown(err));
        }
      }),
    [work],
  );

  const begin = useCallback(
    async (mode: SourceMode, tabId: number | null, snapshot: PageSnapshot) => {
      setNotice(null);
      setFieldErrors({});
      const hints = ProspectFields.parse(hintsFromSnapshot(snapshot));
      const request = toRequest(mode, snapshot, hints);
      const item: WorkItem = {
        id: newId(),
        tabId,
        source: { mode, url: request.url, title: request.title },
        phase: 'extracting',
        fields: hints,
        origins: Object.fromEntries(FIELD_KEYS.map((k) => [k, hints[k] ? 'page' : 'none'])),
        textTruncated: snapshot.textTruncated,
        confirmed: false,
        dials: defaultDials ?? DEFAULT_DIALS,
        draft: null,
        prospectId: null,
        emailChoices: emailChoicesFrom(snapshot),
        expiresAt: null,
        dirty: false,
        staleReason: null,
      };
      await runExtract(item.id, request, item);
    },
    [defaultDials, runExtract],
  );

  const startFromRead = useCallback(
    async (result: ReadResult) => {
      if (!result.ok) setNotice(result);
      else await begin(result.mode, result.tabId, result.snapshot);
    },
    [begin],
  );

  // Consume a read handed over by the service worker. Taken and removed under a lock, so when panels are open in
  // several windows exactly one of them processes it.
  useEffect(() => {
    if (!pending.value) return;
    void navigator.locks.request('op-pending-read', async () => {
      const p = await getStored('session', PENDING_READ_KEY, PendingRead);
      if (!p) return;
      await removeStored('session', PENDING_READ_KEY);
      // Ignore stale hand-offs (for example from before a browser crash).
      if (Date.now() - p.at < 5 * 60_000) void startFromRead(p.result);
    });
  }, [pending.value, startFromRead]);

  // Watch every AI step by queueing for its lock. The lock is granted once the step's panel finishes or closes, and
  // if the item is still mid step at that moment, the step was abandoned, so the fields are unlocked again.
  const watched = useRef(new Set<string>());
  useEffect(() => {
    const w = work.value;
    if (!w || (w.phase !== 'extracting' && w.phase !== 'drafting') || watched.current.has(w.id)) return;
    watched.current.add(w.id);
    void navigator.locks.request(workLock(w.id), async () => {
      watched.current.delete(w.id);
      await mutateWork(w.id, (x) =>
        x.phase === 'extracting' ? { ...x, phase: 'interrupted' } : x.phase === 'drafting' ? { ...x, phase: x.draft ? 'drafted' : 'review' } : x,
      );
    });
  }, [work.value]);

  // Never silently draft for a different page: switching tab or navigating marks the work as stale.
  useEffect(() => {
    const onActivated = ({ tabId }: { tabId: number }) =>
      void getStored('session', WORK_KEY, WorkItem).then((w) => {
        if (!w || w.tabId === null) return;
        if (tabId !== w.tabId && w.staleReason === null) void setStored('session', WORK_KEY, { ...w, staleReason: 'tab' });
        if (tabId === w.tabId && w.staleReason === 'tab') void setStored('session', WORK_KEY, { ...w, staleReason: null });
      });
    const onUpdated = (tabId: number, change: { status?: string; url?: string }) => {
      if (change.status !== 'loading' && change.url === undefined) return;
      void getStored('session', WORK_KEY, WorkItem).then((w) => {
        if (w && w.tabId === tabId && w.staleReason !== 'navigated') void setStored('session', WORK_KEY, { ...w, staleReason: 'navigated' });
      });
    };
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);
    void browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id !== undefined) onActivated({ tabId: tab.id });
    });
    return () => {
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  const update = useCallback(
    (fn: (w: WorkItem) => WorkItem) => {
      const w = work.value;
      if (w) void work.update(fn(w));
    },
    [work],
  );

  /** "Re-read page" from inside the panel. Only works while Chrome's activeTab grant for this tab is still live. */
  const reread = useCallback(async () => {
    setBusy('reading');
    setError(null);
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      await startFromRead(tab ? await readTab(tab) : { ok: false, reason: 'failed', tabId: null, url: null, title: null });
    } finally {
      setBusy(null);
    }
  }, [startFromRead]);

  const fromPaste = useCallback((text: string) => begin('paste', null, snapshotFromText(text)), [begin]);

  const retryExtract = useCallback(() => {
    const last = lastExtract.current;
    if (last) void runExtract(last.workId, last.request);
  }, [runExtract]);

  const setField = (key: FieldKey, value: string) => {
    setFieldErrors((e) => ({ ...e, [key]: undefined }));
    update((w) => ({ ...w, fields: { ...w.fields, [key]: value }, dirty: w.prospectId !== null }));
  };

  /** Validates the loose fields against the strict shared schema, reporting problems per field. */
  const validFields = (fields: LooseFields): ProspectFields | null => {
    const parsed = ProspectFields.safeParse(fields);
    if (parsed.success) return parsed.data;
    const errs: FieldErrors = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as FieldKey;
      errs[key] = key === 'email' ? 'Enter a valid email or leave it empty.' : issue.message;
    }
    setFieldErrors(errs);
    return null;
  };

  const confirm = () => {
    const w = work.value;
    if (!w || !validFields(w.fields)) return;
    update((x) => ({ ...x, confirmed: true }));
  };

  const generate = async () => {
    const w = work.value;
    if (!w) return;
    const fields = validFields(w.fields);
    if (!fields) return;
    setError(null);
    await navigator.locks.request(workLock(w.id), async () => {
      await work.update({ ...w, phase: 'drafting' });
      try {
        // Paste mode carries no URL. Page and selection modes keep the page URL so the prospect is deduplicated.
        const res = await api.draft({ fields, source: { mode: w.source.mode, url: w.source.url, title: w.source.title }, dials: w.dials });
        // prospect is null when the draft was made but the database was unavailable: keep the draft, mark it unsaved.
        await mutateWork(w.id, (x) => ({
          ...x,
          phase: 'drafted',
          draft: res.draft,
          prospectId: res.prospect?.id ?? null,
          expiresAt: res.prospect?.expiresAt ?? null,
          dirty: res.prospect === null,
        }));
        setSavedAt(Date.now());
      } catch (err) {
        await mutateWork(w.id, (x) => ({ ...x, phase: x.draft ? 'drafted' : 'review' }));
        setError(toShown(err));
      }
    });
  };

  const save = async () => {
    const w = work.value;
    if (!w?.prospectId || !w.draft) return;
    const fields = validFields(w.fields);
    if (!fields) return;
    setBusy('saving');
    setError(null);
    try {
      await api.patchProspect(w.prospectId, { ...fields, subject: w.draft.subject, body: w.draft.body });
      await mutateWork(w.id, (x) => ({ ...x, dirty: false }));
      setSavedAt(Date.now());
    } catch (err) {
      setError(toShown(err));
    } finally {
      setBusy(null);
    }
  };

  const clear = async () => {
    lastExtract.current = null;
    setError(null);
    setNotice(null);
    setFieldErrors({});
    await work.update(null);
  };

  return {
    work: work.value,
    loaded: work.loaded,
    notice,
    dismissNotice: () => setNotice(null),
    error,
    dismissError: () => setError(null),
    canRetryExtract: lastExtract.current !== null,
    fieldErrors,
    busy,
    savedAt,
    reread,
    fromPaste,
    retryExtract,
    setField,
    setDials: (dials: Dials) => update((w) => ({ ...w, dials })),
    editDraft: (patch: Partial<{ subject: string; body: string }>) =>
      update((w) => (w.draft ? { ...w, draft: { ...w.draft, ...patch }, dirty: true } : w)),
    unconfirm: () => update((w) => ({ ...w, confirmed: false })),
    keepStale: () => update((w) => ({ ...w, staleReason: null, tabId: null })),
    confirm,
    generate,
    save,
    clear,
  };
}
