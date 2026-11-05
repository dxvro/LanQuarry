import { AlertTriangle, CheckCircle2, Info, Loader2, OctagonAlert, type LucideIcon } from 'lucide-react';
import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ApiError } from '../lib/api';

export const cx = (...parts: Array<string | false | null | undefined>): string => parts.filter(Boolean).join(' ');

export function Spinner({ className }: { className?: string }): ReactNode {
  return <Loader2 aria-hidden className={cx('size-4 animate-spin', className)} />;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'secondary' | 'primary' | 'danger' | 'danger-solid' | 'ghost';
  size?: 'md' | 'sm';
  icon?: LucideIcon;
  loading?: boolean;
  // renders only the icon; the label stays as the accessible name
  iconOnly?: boolean;
}

export function Button({ variant = 'secondary', size = 'md', icon: Icon, loading = false, iconOnly = false, className, children, disabled, type, ...rest }: ButtonProps): ReactNode {
  return (
    <button
      type={type ?? 'button'}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={cx(
        'btn',
        variant === 'primary' && 'btn-primary',
        variant === 'danger' && 'btn-danger',
        variant === 'danger-solid' && 'btn-danger-solid',
        variant === 'ghost' && 'btn-ghost',
        size === 'sm' && 'btn-sm',
        iconOnly && 'btn-icon',
        className,
      )}
      {...(iconOnly && typeof children === 'string' ? { 'aria-label': children, title: children } : {})}
      {...rest}
    >
      {loading ? <Spinner /> : Icon === undefined ? null : <Icon aria-hidden className="size-4 shrink-0" />}
      {iconOnly ? null : children}
    </button>
  );
}

const TONES = {
  info: { icon: Info, box: 'border-accent/40 bg-accent/8', tint: 'text-accent' },
  success: { icon: CheckCircle2, box: 'border-ok/40 bg-ok/8', tint: 'text-ok' },
  warn: { icon: AlertTriangle, box: 'border-warn/40 bg-warn/8', tint: 'text-warn' },
  error: { icon: OctagonAlert, box: 'border-bad/50 bg-bad/10', tint: 'text-bad' },
} as const;

export type Tone = keyof typeof TONES;

interface NoticeProps {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function Notice({ tone = 'info', title, children, action, className }: NoticeProps): ReactNode {
  const { icon: Icon, box, tint } = TONES[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('flex gap-3 rounded-lg border p-3', box, className)}>
      <Icon aria-hidden className={cx('mt-0.5 size-4 shrink-0', tint)} />
      <div className="min-w-0 flex-1 space-y-1">
        {title === undefined ? null : <p className="font-medium text-ink">{title}</p>}
        {children === undefined ? null : <div className="text-dim">{children}</div>}
        {action === undefined ? null : <div className="pt-1">{action}</div>}
      </div>
    </div>
  );
}

interface ErrorNoticeProps {
  error: unknown;
  title?: string;
  action?: ReactNode;
  className?: string;
}

// Shows the backend's German message as it is; the validation details of a 400 are listed below it.
export function ErrorNotice({ error, title, action, className }: ErrorNoticeProps): ReactNode {
  const api = error instanceof ApiError ? error : null;
  const message = error instanceof Error ? error.message : 'Unbekannter Fehler.';
  const details = api?.code === 'VALIDATION_ERROR' && Array.isArray(api.details) ? (api.details as Array<{ path?: unknown; message?: unknown }>) : [];
  return (
    <Notice tone="error" {...(title === undefined ? {} : { title })} {...(action === undefined ? {} : { action })} {...(className === undefined ? {} : { className })}>
      <p>{message}</p>
      {details.length > 0 ? (
        <ul className="mt-1 list-disc pl-5">
          {details.map((detail, index) => (
            <li key={index}>
              {typeof detail.path === 'string' && detail.path !== '' ? `${detail.path}: ` : ''}
              {typeof detail.message === 'string' ? detail.message : ''}
            </li>
          ))}
        </ul>
      ) : null}
      {api === null || api.code.startsWith('HTTP_') ? null : <p className="hint mt-1">Fehlercode: {api.code}</p>}
    </Notice>
  );
}

export function LoadingBlock({ label = 'Wird geladen …', className }: { label?: string; className?: string }): ReactNode {
  return (
    <div role="status" className={cx('flex items-center gap-2 py-6 text-dim', className)}>
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, children, action }: EmptyStateProps): ReactNode {
  return (
    <div className="panel flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-raised text-accent">
        <Icon aria-hidden className="size-6" />
      </span>
      <h2 className="text-lg">{title}</h2>
      {children === undefined ? null : <div className="max-w-md text-dim">{children}</div>}
      {action === undefined ? null : <div className="pt-2">{action}</div>}
    </div>
  );
}

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
  children: (props: { id: string; 'aria-describedby': string | undefined; 'aria-invalid': true | undefined }) => ReactNode;
  className?: string;
}

export function Field({ label, hint, error, children, className }: FieldProps): ReactNode {
  const id = useId();
  const describedBy = [hint === undefined ? null : `${id}-hint`, error === undefined ? null : `${id}-error`].filter(Boolean).join(' ');
  return (
    <div className={cx('space-y-1.5', className)}>
      <label htmlFor={id} className="label block">
        {label}
      </label>
      {children({ id, 'aria-describedby': describedBy === '' ? undefined : describedBy, 'aria-invalid': error === undefined ? undefined : true })}
      {hint === undefined ? null : (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p id={`${id}-error`} role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: ReactNode;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, description, disabled = false }: ToggleProps): ReactNode {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p id={`${id}-label`} className="font-medium">
          {label}
        </p>
        {description === undefined ? null : <p className="hint">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 h-6 w-11 shrink-0 cursor-pointer rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'border-accent bg-accent' : 'border-line-strong bg-raised',
        )}
      >
        <span
          aria-hidden
          className={cx('absolute top-0.5 size-4.5 rounded-full transition-all', checked ? 'left-5.5 bg-on-accent' : 'left-0.5 bg-dim')}
        />
      </button>
    </div>
  );
}

interface RangeProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format: (value: number) => string;
  error?: string | undefined;
  disabled?: boolean;
}

export function Range({ label, value, min, max, step, onChange, format, error, disabled = false }: RangeProps): ReactNode {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="label">
          {label}
        </label>
        <output htmlFor={id} className="num font-medium">
          {format(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={format(value)}
        aria-invalid={error === undefined ? undefined : true}
        onChange={(event) => onChange(Number(event.target.value))}
        className="block h-8 w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
      />
      {error === undefined ? null : (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

export function Section({ title, description, children, action }: { title: string; description?: ReactNode; children: ReactNode; action?: ReactNode }): ReactNode {
  const id = useId();
  return (
    <section aria-labelledby={id} className="panel p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={id} className="text-base">
            {title}
          </h2>
          {description === undefined ? null : <p className="hint mt-0.5">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
