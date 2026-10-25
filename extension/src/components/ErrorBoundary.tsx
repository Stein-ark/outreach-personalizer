/**
 * Contains a crash to one section of the panel. The other tabs keep working, and the section can be retried.
 */
import { Component, type ReactNode } from 'react';
import { RotateCw } from 'lucide-react';
import { Banner, Button } from './ui';

interface Props {
  section: string;
  children: ReactNode;
}

export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Banner
        tone="error"
        title={`The ${this.props.section} section stopped working`}
        actions={<Button size="sm" icon={RotateCw} onClick={() => this.setState({ failed: false })}>Try again</Button>}
      >
        The other sections still work. Your current prospect is kept. If this keeps happening, close and reopen the panel.
      </Banner>
    );
  }
}
