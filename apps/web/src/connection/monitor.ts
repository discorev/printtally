import type { HealthResponse } from 'print-accounting-contracts';
import { ApiError } from '../api/client.ts';
import { canEdit, initialConnection, reduce, type ConnectionEvent, type ConnectionState } from './state.ts';

export interface MonitorOptions {
  fetchHealth: () => Promise<HealthResponse>; // Throws ApiError('unreachable' | 'unauthorized').
  pollMs?: number; // How often health is checked while connected.
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}
type Listener = (state: ConnectionState, previous: ConnectionState) => void;

// Polls the server's health, and hears about every API request (client.ts). A failed request or check
// marks the server lost and schedules retries with backoff; the first successful check recovers.
export class ConnectionMonitor {
  private state = initialConnection;
  private listeners = new Set<Listener>();
  private timer: unknown;
  private checking: Promise<void> | undefined;
  private generation = 0; // Bumped by reset(), so a check started before it can't touch what follows.
  private readonly fetchHealth: () => Promise<HealthResponse>;
  private readonly pollMs: number;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;

  constructor(options: MonitorOptions) {
    this.fetchHealth = options.fetchHealth;
    this.pollMs = options.pollMs ?? 10_000;
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = options.clearTimer ?? (timer => clearTimeout(timer as ReturnType<typeof setTimeout>));
  }

  getState = (): ConnectionState => this.state;
  canEdit = (): boolean => canEdit(this.state);
  subscribe = (listener: Listener): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  /** Checks health now (sharing a check already running) and schedules the next one. */
  check = (): Promise<void> => {
    this.checking ??= this.run().finally(() => { this.checking = undefined; });
    return this.checking;
  };

  /** A request elsewhere failed or succeeded. Only failures change anything: recovery is confirmed by a health check. */
  report(outcome: 'ok' | 'unreachable' | 'unauthorized'): void {
    if (outcome === 'unauthorized') { this.dispatch({ type: 'unauthorized' }); this.stop(); }
    else if (outcome === 'unreachable' && this.state.status === 'connected') { this.dispatch({ type: 'unreachable' }); this.schedule(); }
  }

  stop(): void { if (this.timer !== undefined) this.clearTimer(this.timer); this.timer = undefined; }

  /** Discard state and scheduled checks between independent component-test renders. */
  reset(): void { this.stop(); this.generation++; this.checking = undefined; this.state = initialConnection; }

  private async run(): Promise<void> {
    const generation = this.generation;
    let event: ConnectionEvent;
    try { event = { type: 'ok', health: await this.fetchHealth() }; }
    catch (error) { event = { type: error instanceof ApiError && error.kind === 'unauthorized' ? 'unauthorized' : 'unreachable' }; }
    if (generation !== this.generation) return;
    this.dispatch(event);
    this.schedule();
  }

  private schedule(): void {
    this.stop();
    const { status, retryAt } = this.state;
    if (status === 'unauthorized') return; // Signing in again reloads the page; nothing to poll for.
    const delay = status === 'lost' && retryAt !== null ? Math.max(0, retryAt - this.now()) : this.pollMs;
    this.timer = this.setTimer(() => { void this.check(); }, delay);
  }

  private dispatch(event: ConnectionEvent): void {
    const previous = this.state;
    this.state = reduce(previous, event, this.now());
    if (this.state !== previous) for (const listener of this.listeners) listener(this.state, previous);
  }
}
