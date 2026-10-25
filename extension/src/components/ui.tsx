/**
 * Small, accessible building blocks. Everything renders text as React text nodes, never as HTML.
 */
import { useEffect, useId, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AlertTriangle, Info, LoaderCircle, OctagonAlert, type LucideIcon } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-action text-action-ink hover:brightness-110 disabled:opacity-50',
  secondary: 'bg-surface text-ink border border-rule hover:border-ink-soft disabled:opacity-50',
  quiet: 'text-ink-soft hover:text-ink hover:bg-surface disabled:opacity-50',
  danger: 'bg-danger-soft text-danger border border-transparent hover:border-danger disabled:opacity-50',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: LucideIcon;
  busy?: boolean;
  size?: 'sm' | 'md';
}

export function Button({ variant = 'secondary', icon: Icon, busy, size = 'md', className = '', children, disabled, ...rest }: ButtonProps) {
  const pad = size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-10 px-3.5';
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors ${pad} ${VARIANTS[variant]} ${className}`}
    >
      {busy ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : Icon ? <Icon aria-hidden className="size-4" /> : null}
      {children}
    </button>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  rows?: number;
  type?: 'text' | 'email' | 'password' | 'url';
  hint?: ReactNode;
  tag?: ReactNode;
  error?: string | null;
  maxLength?: number;
  disabled?: boolean;
  autoComplete?: string;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
}

export function Field({ label, value, onChange, multiline, rows = 3, type = 'text', hint, tag, error, maxLength, disabled, autoComplete, placeholder, className = '', inputClassName = '' }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  const base = `w-full rounded-md border bg-surface px-2.5 py-2 text-ink placeholder:text-ink-soft/70 disabled:opacity-60 ${error ? 'border-danger' : 'border-rule focus:border-ink-soft'} ${inputClassName}`;
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[13px] font-medium text-ink">
          {label}
        </label>
        {tag}
      </div>
      {multiline ? (
        <textarea id={id} rows={rows} value={value} maxLength={maxLength} disabled={disabled} placeholder={placeholder} aria-invalid={!!error} aria-describedby={describedBy} onChange={(e) => onChange(e.target.value)} className={`${base} resize-y`} />
      ) : (
        <input id={id} type={type} value={value} maxLength={maxLength} disabled={disabled} autoComplete={autoComplete} placeholder={placeholder} aria-invalid={!!error} aria-describedby={describedBy} onChange={(e) => onChange(e.target.value)} className={`${base} h-9`} />
      )}
      {hint ? (
        <p id={hintId} className="text-[12px] text-ink-soft">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-[12px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface ChoiceProps<T extends string> {
  legend: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}

/** A radio group drawn as a segmented control. Arrow keys move between options, as with native radios. */
export function Choice<T extends string>({ legend, value, options, onChange }: ChoiceProps<T>) {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-[13px] font-medium text-ink">{legend}</legend>
      <div className="flex rounded-md border border-rule bg-surface p-0.5">
        {options.map((o) => (
          <label key={o.value} className={`flex-1 cursor-pointer rounded-[5px] px-1.5 py-1.5 text-center text-[13px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--focus)] ${value === o.value ? 'bg-ink text-paper' : 'text-ink-soft hover:text-ink'}`}>
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

type Tone = 'info' | 'warn' | 'error';
const TONES: Record<Tone, { cls: string; icon: LucideIcon }> = {
  info: { cls: 'bg-surface border-rule text-ink', icon: Info },
  warn: { cls: 'bg-warn-soft border-transparent text-ink', icon: AlertTriangle },
  error: { cls: 'bg-danger-soft border-transparent text-ink', icon: OctagonAlert },
};

export function Banner({ tone = 'info', title, children, actions }: { tone?: Tone; title: string; children?: ReactNode; actions?: ReactNode }) {
  const { cls, icon: Icon } = TONES[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex gap-2.5 rounded-lg border p-3 ${cls}`}>
      <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${tone === 'warn' ? 'text-warn' : tone === 'error' ? 'text-danger' : 'text-ink-soft'}`} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="font-semibold">{title}</p>
        {children ? <div className="text-[13px] text-ink-soft">{children}</div> : null}
        {actions ? <div className="mt-1 flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

/** Seconds left until a deadline, ticking once a second. Returns 0 when passed. */
export function useCountdown(until: number | null): number {
  const left = () => (until ? Math.max(0, Math.ceil((until - Date.now()) / 1000)) : 0);
  const [seconds, setSeconds] = useState(left);
  useEffect(() => {
    setSeconds(left());
    if (!until) return;
    const t = setInterval(() => {
      const s = left();
      setSeconds(s);
      if (s === 0) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [until]);
  return seconds;
}

export function Spinner({ label }: { label: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-ink-soft">
      <LoaderCircle aria-hidden className="size-4 animate-spin" />
      {label}
    </p>
  );
}
