import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/**
 * Last line of defence. A bug in one screen must not blank the whole app, and
 * the user must never be shown a stack trace - the detail goes to the console
 * and they get a way back.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Deliberately console-only: this is the boundary of last resort and has no
    // reporting transport configured. Swap for a real reporter when one exists.
    console.error('Unhandled UI error', error, info?.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="grid min-h-dvh place-items-center bg-background px-4">
        <div className="card w-full max-w-md p-6 text-center">
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-danger-soft text-danger">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </span>
          <h1 className="mt-3 text-base font-semibold text-foreground">This page hit an unexpected error</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            The rest of the application is still available. Reloading usually clears it.
          </p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button variant="outline" onClick={() => window.history.back()}>
              Go back
            </Button>
            <Button onClick={() => window.location.reload()}>
              <RefreshCw className="h-3.5 w-3.5" />
              Reload
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
