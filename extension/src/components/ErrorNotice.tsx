/** Turns any API error into a clear message with the one action that fixes it. */
import { RotateCw, Settings as SettingsIcon } from 'lucide-react';
import { ApiError } from '../lib/http';
import { Banner, Button, useCountdown } from './ui';

export interface ShownError {
  error: ApiError;
  /** When the error happened, used for retry countdowns. */
  at: number;
}

export const toShown = (err: unknown): ShownError => ({
  error: err instanceof ApiError ? err : new ApiError('BAD_RESPONSE', 'Something unexpected happened. Try again.'),
  at: Date.now(),
});

interface Props {
  shown: ShownError;
  onRetry?: () => void;
  onOpenSettings?: () => void;
  onDismiss?: () => void;
}

export function ErrorNotice({ shown, onRetry, onOpenSettings, onDismiss }: Props) {
  const { error, at } = shown;
  const wait = error.retryAfterSeconds ? at + error.retryAfterSeconds * 1000 : null;
  const seconds = useCountdown(wait);
  const retry = onRetry ? (
    <Button size="sm" icon={RotateCw} onClick={onRetry} disabled={seconds > 0}>
      {seconds > 0 ? `Try again in ${seconds} s` : 'Try again'}
    </Button>
  ) : null;
  const dismiss = onDismiss ? (
    <Button size="sm" variant="quiet" onClick={onDismiss}>
      Dismiss
    </Button>
  ) : null;

  switch (error.code) {
    case 'OFFLINE':
      return <Banner tone="warn" title="You're offline" actions={<>{retry}{dismiss}</>}>Reconnect to the internet, then try again. Your work is kept.</Banner>;
    case 'UNREACHABLE':
    case 'TIMEOUT':
      return <Banner tone="error" title="Can't reach the server" actions={<>{retry}{dismiss}</>}>{error.message}</Banner>;
    case 'AI_RATE_LIMITED':
    case 'RATE_LIMITED':
      return (
        <Banner tone="warn" title="Busy right now" actions={<>{retry}{dismiss}</>}>
          {seconds > 0 ? `The request limit was reached. You can try again in ${seconds} seconds.` : 'You can try again now.'}
        </Banner>
      );
    case 'DAILY_CAP':
      return <Banner tone="warn" title="Daily limit reached" actions={dismiss}>{error.message}</Banner>;
    case 'PROFILE_INCOMPLETE':
      return (
        <Banner
          tone="warn"
          title="Finish your sender profile"
          actions={onOpenSettings ? <Button size="sm" icon={SettingsIcon} onClick={onOpenSettings}>Open settings</Button> : null}
        >
          Drafts need your name, organisation and what you are raising for or offering.
        </Banner>
      );
    case 'AI_FAILED':
    case 'AI_UNAVAILABLE':
      return <Banner tone="error" title="The AI step failed" actions={<>{retry}{dismiss}</>}>{error.message}</Banner>;
    default:
      return <Banner tone="error" title="That didn't work" actions={<>{retry}{dismiss}</>}>{error.message}</Banner>;
  }
}
