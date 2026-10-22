import { Injectable, OnDestroy, signal } from '@angular/core';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';

/**
 * Polls /api/messenger/unread-count on a fixed interval so the toolbar can
 * show a badge next to the Messages nav link. Auto-pauses when the user
 * isn't logged in or doesn't have permission to see the Messages page.
 */
@Injectable({ providedIn: 'root' })
export class MessengerNotificationsService implements OnDestroy {
  /** Newest unread-thread count. 0 hides the badge. */
  unreadCount = signal(0);

  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly POLL_MS = 30_000;

  constructor(private api: ApiService, private auth: AuthService) {
    // Start once the user is logged in with the right permission level.
    this.maybeStart();
    // React to login/logout by re-running the check on visibility change,
    // which is when most users come back to the app anyway.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.tick();
    });
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Call after login to (re)arm the poller. */
  maybeStart(): void {
    if (this.timer) return;
    if (!this.eligible()) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), this.POLL_MS);
  }

  /** Call after logout or on 401 to freeze the badge. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unreadCount.set(0);
  }

  /** Force an immediate refresh (used when the user opens/reads a thread). */
  refresh(): void {
    this.tick();
  }

  private eligible(): boolean {
    return this.auth.isLoggedIn && this.auth.canAccessComputers();
  }

  private tick(): void {
    if (!this.eligible()) { this.stop(); return; }
    this.api.getMessengerUnreadCount().subscribe({
      next: (res) => this.unreadCount.set(res.count ?? 0),
      error: () => { /* silent — probably a transient 401/500 */ }
    });
  }
}
