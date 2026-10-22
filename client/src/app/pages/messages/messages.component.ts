import {
  AfterViewChecked, Component, ElementRef, OnDestroy, OnInit, ViewChild, signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { MessengerNotificationsService } from '../../services/messenger-notifications.service';
import { Computer, MessengerMessage, MessengerThread } from '../../models';
import { computerDisplayName } from '../../part-display';

/**
 * Marketplace / Messenger inbox. Talks to /api/messenger/* and shows threads
 * scraped by the Chrome extension (see /messenger-extension). Composing a
 * reply posts to /api/messenger/threads/{id}/reply which enqueues the send
 * in MessengerOutbox; the extension picks it up on its next poll and drives
 * the messenger.com DOM.
 */
@Component({
  selector: 'app-messages',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterLink, MatButtonModule, MatIconModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatProgressSpinnerModule, MatTooltipModule,
    MatSlideToggleModule, MatSnackBarModule
  ],
  template: `
    <div class="page-container messages-page">
      <div class="header-row">
        <h1>Messages</h1>
        <span class="spacer"></span>
        <mat-slide-toggle [(ngModel)]="unreadOnly" (change)="loadThreads()">Unread only</mat-slide-toggle>
        @if (canManageRules) {
          <a mat-button routerLink="/messages/rules" matTooltip="Auto-responder rules">
            <mat-icon>auto_awesome</mat-icon>
            <span class="nav-label-inline">Rules</span>
          </a>
        }
        <button mat-icon-button matTooltip="Refresh" (click)="loadThreads(); loadMessages(true)">
          <mat-icon>refresh</mat-icon>
        </button>
      </div>

      <div class="two-pane" [class.thread-open]="!!selectedThread">
        <!-- Thread list -->
        <aside class="thread-pane">
          @if (loading()) {
            <div class="center"><mat-spinner diameter="32"></mat-spinner></div>
          } @else if (threads.length === 0) {
            <div class="empty">
              No threads yet. Open Facebook Messenger with the BenBot Messenger
              Bridge extension installed, view a Marketplace conversation, then
              refresh this page.
            </div>
          } @else {
            <ul class="thread-list">
              @for (t of threads; track t.id) {
                <li class="thread-row"
                    [class.selected]="t.id === selectedThread?.id"
                    [class.unread]="t.unread"
                    (click)="selectThread(t)">
                  <div class="row-top">
                    <span class="counterparty">
                      {{ t.counterpartyName || '(unknown)' }}
                    </span>
                    <span class="row-time">{{ shortTime(t.lastMessageDate) }}</span>
                  </div>
                  @if (t.listingTitle) {
                    <div class="listing-title" [matTooltip]="t.listingTitle">
                      <mat-icon>storefront</mat-icon> {{ t.listingTitle }}
                    </div>
                  }
                  <div class="preview">
                    @if (t.lastMessage) {
                      @if (t.lastMessage.direction === 'outgoing') {
                        <span class="preview-you">You:</span>
                      }
                      {{ t.lastMessage.text }}
                    } @else {
                      <em class="muted">no messages yet</em>
                    }
                  </div>
                  <div class="row-badges">
                    @if (t.unread) { <span class="pill unread">new</span> }
                    @if (t.pendingReplies > 0) {
                      <span class="pill pending" matTooltip="Replies queued for the extension to send">
                        {{ t.pendingReplies }} queued
                      </span>
                    }
                    @if (t.computerId) {
                      <span class="pill linked" [matTooltip]="computerName(t.computerId) ?? ''">
                        <mat-icon>link</mat-icon> {{ computerName(t.computerId) ?? '#' + t.computerId }}
                      </span>
                    }
                  </div>
                </li>
              }
            </ul>
          }
        </aside>

        <!-- Transcript + composer -->
        <section class="thread-view">
          @if (!selectedThread) {
            <div class="placeholder">
              <mat-icon>chat_bubble_outline</mat-icon>
              <p>Select a thread to see the transcript.</p>
            </div>
          } @else {
            <header class="view-header">
              <button mat-icon-button class="back-btn" (click)="selectedThread = null" aria-label="Back">
                <mat-icon>arrow_back</mat-icon>
              </button>
              <div class="view-title">
                <div class="view-counterparty">{{ selectedThread.counterpartyName || '(unknown)' }}</div>
                @if (selectedThread.listingTitle) {
                  <a class="view-listing" [href]="selectedThread.listingUrl" target="_blank" rel="noopener">
                    <mat-icon>storefront</mat-icon> {{ selectedThread.listingTitle }}
                  </a>
                }
              </div>
              <span class="spacer"></span>

              <mat-form-field appearance="outline" class="link-field" subscriptSizing="dynamic">
                <mat-label>Link to build</mat-label>
                <mat-select [ngModel]="selectedThread.computerId ?? null"
                            (selectionChange)="onLinkComputer($event.value)">
                  <mat-option [value]="null">(none)</mat-option>
                  @for (c of computers; track c.id) {
                    <mat-option [value]="c.id">
                      {{ computerDisplayName(c) }} <span class="opt-status">— {{ c.status }}</span>
                    </mat-option>
                  }
                </mat-select>
              </mat-form-field>

              <a mat-icon-button
                 matTooltip="Open in Messenger"
                 [href]="'https://www.messenger.com/t/' + selectedThread.fbThreadId"
                 target="_blank" rel="noopener">
                <mat-icon>open_in_new</mat-icon>
              </a>
            </header>

            <div class="transcript" #transcript>
              @if (messagesLoading()) {
                <div class="center"><mat-spinner diameter="24"></mat-spinner></div>
              } @else if (messages.length === 0) {
                <div class="empty">No messages ingested yet for this thread.</div>
              } @else {
                @for (m of messages; track m.id) {
                  <div class="bubble" [class.incoming]="m.direction === 'incoming'"
                                      [class.outgoing]="m.direction === 'outgoing'">
                    @if (m.text) {
                      <div class="bubble-text">{{ m.text }}</div>
                    }
                    @if ((m.attachments?.length ?? 0) > 0) {
                      <div class="bubble-attachments">
                        @for (a of m.attachments; track a.id) {
                          <a [href]="attachmentUrl(a.id)" target="_blank" rel="noopener">
                            <img [src]="attachmentUrl(a.id)"
                                 [alt]="'attachment ' + a.id"
                                 loading="lazy" />
                          </a>
                        }
                      </div>
                    }
                    <div class="bubble-meta">
                      {{ m.timestamp | date:'shortDate' }} · {{ m.timestamp | date:'shortTime' }}
                    </div>
                  </div>
                }
              }
            </div>

            <footer class="composer">
              <mat-form-field appearance="outline" class="reply-field" subscriptSizing="dynamic">
                <mat-label>Reply</mat-label>
                <textarea matInput rows="3"
                          [(ngModel)]="replyText"
                          (keydown)="onReplyKeydown($event)"
                          [disabled]="sending()"
                          placeholder="Type a reply — Ctrl+Enter to queue for send"></textarea>
              </mat-form-field>
              <div class="composer-actions">
                <span class="composer-hint">
                  Replies are queued and sent by the extension when a Messenger tab is open.
                </span>
                <span class="spacer"></span>
                <button mat-flat-button color="primary"
                        [disabled]="!replyText.trim() || sending()"
                        (click)="sendReply()">
                  @if (sending()) {
                    <mat-spinner diameter="18"></mat-spinner>
                  } @else {
                    <mat-icon>send</mat-icon>
                  }
                  Queue reply
                </button>
              </div>
            </footer>
          }
        </section>
      </div>
    </div>
  `,
  styles: [`
    .messages-page { display: flex; flex-direction: column; height: calc(100vh - 56px); box-sizing: border-box; }
    .header-row { display: flex; align-items: center; gap: 12px; padding: 12px 16px 8px; flex-wrap: wrap; }
    .header-row h1 { margin: 0; font-size: 20px; }
    .spacer { flex: 1; }

    .two-pane {
      display: grid;
      grid-template-columns: 320px 1fr;
      gap: 12px;
      padding: 0 12px 12px;
      flex: 1;
      min-height: 0;
    }
    @media (max-width: 800px) {
      .two-pane { grid-template-columns: 1fr; }
      .two-pane.thread-open .thread-pane { display: none; }
      .two-pane:not(.thread-open) .thread-view { display: none; }
    }

    .thread-pane {
      background: #fff;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .thread-list {
      list-style: none;
      margin: 0;
      padding: 0;
      overflow-y: auto;
    }
    .thread-row {
      padding: 10px 12px;
      border-bottom: 1px solid #f2f2f2;
      cursor: pointer;
      transition: background 100ms;
    }
    .thread-row:hover { background: #f7fbff; }
    .thread-row.selected { background: #e3f2fd; }
    .thread-row.unread { background: #fff9e6; }
    .thread-row.unread.selected { background: #ffe9b3; }
    .row-top {
      display: flex;
      align-items: baseline;
      gap: 8px;
    }
    .counterparty {
      flex: 1;
      font-weight: 600;
      font-size: 14px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .row-time {
      color: #888;
      font-size: 11px;
      flex-shrink: 0;
    }
    .listing-title {
      color: #666;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 4px;
      margin: 2px 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .listing-title mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }
    .preview {
      color: #555;
      font-size: 13px;
      line-height: 1.35;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      margin-top: 2px;
    }
    .preview-you { color: #888; font-weight: 600; margin-right: 2px; }
    .muted { color: #aaa; }
    .row-badges { margin-top: 4px; display: flex; gap: 4px; flex-wrap: wrap; }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      font-size: 11px;
      padding: 1px 8px;
      border-radius: 10px;
      background: #eee;
      color: #555;
    }
    .pill.unread { background: #ffca28; color: #4a3400; }
    .pill.pending { background: #b39ddb; color: #311b92; }
    .pill.linked { background: #c8e6c9; color: #1b5e20; }
    .pill mat-icon {
      font-size: 12px;
      width: 12px;
      height: 12px;
    }

    .thread-view {
      background: #fff;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
    }
    .placeholder {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #999;
      gap: 8px;
    }
    .placeholder mat-icon { font-size: 42px; width: 42px; height: 42px; }

    .view-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid #eee;
      background: #fafafa;
    }
    .back-btn { display: none; }
    @media (max-width: 800px) {
      .back-btn { display: inline-flex; }
    }
    .view-title { min-width: 0; }
    .view-counterparty { font-weight: 600; font-size: 15px; }
    .view-listing {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: #1565c0;
      text-decoration: none;
    }
    .view-listing mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .link-field { width: 200px; }
    .opt-status { color: #888; font-size: 12px; }

    .transcript {
      flex: 1;
      overflow-y: auto;
      padding: 14px;
      background: #f7f9fc;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .bubble {
      max-width: 68%;
      padding: 8px 12px;
      border-radius: 14px;
      box-shadow: 0 1px 2px rgba(0,0,0,0.04);
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 14px;
      line-height: 1.35;
    }
    .bubble.incoming { align-self: flex-start; background: #fff; border: 1px solid #e0e0e0; border-bottom-left-radius: 4px; }
    .bubble.outgoing { align-self: flex-end; background: #1976d2; color: #fff; border-bottom-right-radius: 4px; }
    .bubble.outgoing .bubble-meta { color: rgba(255,255,255,0.8); }
    .bubble-meta { font-size: 11px; color: #888; margin-top: 3px; text-align: right; }
    .bubble-attachments {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 6px;
    }
    .bubble-attachments img {
      max-width: 200px;
      max-height: 200px;
      border-radius: 8px;
      object-fit: cover;
      display: block;
      background: #f0f0f0;
    }
    .nav-label-inline { margin-left: 4px; }

    .composer {
      border-top: 1px solid #eee;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      background: #fff;
    }
    .reply-field { width: 100%; }
    .composer-actions { display: flex; align-items: center; gap: 8px; }
    .composer-hint { color: #888; font-size: 12px; }

    .center { display: flex; justify-content: center; padding: 32px; }
    .empty { text-align: center; padding: 32px 16px; color: #888; font-size: 13px; }
  `]
})
export class MessagesComponent implements OnInit, OnDestroy, AfterViewChecked {
  computerDisplayName = computerDisplayName;
  threads: MessengerThread[] = [];
  computers: Computer[] = [];
  selectedThread: MessengerThread | null = null;
  messages: MessengerMessage[] = [];

  loading = signal(true);
  messagesLoading = signal(false);
  sending = signal(false);
  unreadOnly = false;
  replyText = '';

  private threadPollTimer: ReturnType<typeof setInterval> | null = null;
  private msgPollTimer: ReturnType<typeof setInterval> | null = null;
  private computerNameCache = new Map<number, string>();
  private lastMessageCount = 0;

  @ViewChild('transcript') transcriptEl?: ElementRef<HTMLDivElement>;

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private route: ActivatedRoute,
    private router: Router,
    private snack: MatSnackBar,
    private notifications: MessengerNotificationsService
  ) {}

  get canManageRules(): boolean {
    return this.auth.permissionLevel() >= 3;
  }

  attachmentUrl(id: number): string {
    return this.api.messengerAttachmentUrl(id);
  }

  ngOnInit(): void {
    this.loadComputersForLink();
    this.loadThreads(() => {
      // Deep link support: /messages?thread=<id>
      const t = this.route.snapshot.queryParamMap.get('thread');
      if (t) {
        const target = this.threads.find(x => x.id === Number(t));
        if (target) this.selectThread(target);
      }
    });

    // Auto-refresh threads every 20s and open transcript every 10s.
    this.threadPollTimer = setInterval(() => this.loadThreads(), 20000);
    this.msgPollTimer = setInterval(() => {
      if (this.selectedThread) this.loadMessages();
    }, 10000);
  }

  ngOnDestroy(): void {
    if (this.threadPollTimer) clearInterval(this.threadPollTimer);
    if (this.msgPollTimer) clearInterval(this.msgPollTimer);
  }

  ngAfterViewChecked(): void {
    // Autoscroll transcript to bottom whenever new messages come in.
    if (this.messages.length !== this.lastMessageCount) {
      this.lastMessageCount = this.messages.length;
      const el = this.transcriptEl?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }

  loadThreads(afterLoad?: () => void): void {
    this.loading.set(true);
    this.api.getMessengerThreads(this.unreadOnly).subscribe({
      next: (threads) => {
        this.threads = threads ?? [];
        this.loading.set(false);
        // Keep the currently-selected thread in sync (unread state, listing title, etc.)
        if (this.selectedThread) {
          const updated = this.threads.find(t => t.id === this.selectedThread!.id);
          if (updated) this.selectedThread = updated;
        }
        afterLoad?.();
      },
      error: () => this.loading.set(false)
    });
  }

  loadMessages(force = false): void {
    if (!this.selectedThread) return;
    // Only show the spinner on the first load of a thread; polls happen silently.
    if (force || this.messages.length === 0) this.messagesLoading.set(true);
    this.api.getMessengerMessages(this.selectedThread.id).subscribe({
      next: (msgs) => {
        this.messages = msgs ?? [];
        this.messagesLoading.set(false);
      },
      error: () => this.messagesLoading.set(false)
    });
  }

  selectThread(t: MessengerThread): void {
    if (this.selectedThread?.id === t.id) return;
    this.selectedThread = t;
    this.messages = [];
    this.lastMessageCount = 0;
    this.loadMessages(true);
    // Fire-and-forget mark-as-read.
    if (t.unread) {
      this.api.markMessengerRead(t.id).subscribe({
        next: () => {
          t.unread = false;
          this.notifications.refresh();
        }
      });
    }
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { thread: t.id },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  sendReply(): void {
    const text = this.replyText.trim();
    if (!text || !this.selectedThread) return;
    this.sending.set(true);
    this.api.queueMessengerReply(this.selectedThread.id, text).subscribe({
      next: () => {
        this.replyText = '';
        this.sending.set(false);
        this.snack.open('Reply queued — the extension will send it on its next poll.', undefined, { duration: 3500 });
        this.loadThreads();
      },
      error: (err) => {
        this.sending.set(false);
        this.snack.open('Failed to queue reply: ' + (err?.error?.message || err?.message || 'unknown'), 'Dismiss');
      }
    });
  }

  onReplyKeydown(ev: KeyboardEvent): void {
    // Ctrl+Enter or Cmd+Enter queues without needing to move the mouse.
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      this.sendReply();
    }
  }

  onLinkComputer(computerId: number | null): void {
    if (!this.selectedThread) return;
    const threadId = this.selectedThread.id;
    this.api.linkMessengerThreadToComputer(threadId, computerId ?? null).subscribe({
      next: () => {
        if (this.selectedThread && this.selectedThread.id === threadId) {
          this.selectedThread.computerId = computerId ?? null;
        }
        // Also refresh the row in the sidebar list.
        const row = this.threads.find(t => t.id === threadId);
        if (row) row.computerId = computerId ?? null;
        this.snack.open(computerId ? 'Linked to build.' : 'Unlinked.', undefined, { duration: 2000 });
      },
      error: (err) => this.snack.open(
        'Link failed: ' + (err?.error?.message || err?.message || 'unknown'), 'Dismiss')
    });
  }

  computerName(id: number | null | undefined): string | null {
    if (id == null) return null;
    return this.computerNameCache.get(id) ?? null;
  }

  shortTime(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.getFullYear() === now.getFullYear()
      && d.getMonth() === now.getMonth()
      && d.getDate() === now.getDate();
    if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  private loadComputersForLink(): void {
    // Lightweight fetch — same endpoint the Computers page uses. Cached only
    // for the lifetime of this page; the list changes rarely.
    this.api.getComputers().subscribe({
      next: (list) => {
        // Show "linkable" builds first: exclude Sold / Traded / Returned.
        const excluded = new Set(['Sold', 'Traded', 'Returned']);
        this.computers = (list ?? [])
          .filter(c => !excluded.has(c.status))
          .sort((a, b) => computerDisplayName(a).localeCompare(computerDisplayName(b), undefined, { sensitivity: 'base' }));
        for (const c of list ?? []) this.computerNameCache.set(c.id, computerDisplayName(c));
      },
      error: () => { /* silent — link dropdown just stays empty */ }
    });
  }
}
