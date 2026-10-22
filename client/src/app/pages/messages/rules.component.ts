import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ApiService } from '../../services/api.service';
import { MessengerRule, MessengerRuleMatchType } from '../../models';

/**
 * CRUD screen for auto-responder rules. Rules are evaluated in ascending
 * OrderIndex against the newest incoming message per thread whenever the
 * extension ingests new activity; the first match (subject to cooldown)
 * enqueues a reply into MessengerOutbox.
 *
 * Placeholders supported in the response body:
 *   {counterparty}  buyer/seller display name
 *   {listing}       Marketplace listing title
 *   {build}         name of the linked Computer, if any
 *   {price}         Computer.Price
 *   {text}          the incoming message body
 */
@Component({
  selector: 'app-messenger-rules',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterLink, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatSlideToggleModule,
    MatCheckboxModule, MatTooltipModule, MatProgressSpinnerModule, MatSnackBarModule
  ],
  template: `
    <div class="page-container rules-page">
      <div class="header-row">
        <a mat-icon-button routerLink="/messages" matTooltip="Back to Messages">
          <mat-icon>arrow_back</mat-icon>
        </a>
        <h1>Auto-responder rules</h1>
        <span class="spacer"></span>
        <button mat-flat-button color="primary" (click)="addNew()">
          <mat-icon>add</mat-icon> Add rule
        </button>
      </div>

      <p class="hint">
        Rules are evaluated top-to-bottom against the newest incoming message per thread.
        The first match (that isn't in cooldown) enqueues a reply for the extension to send.
        Placeholders: <code>&#123;counterparty&#125;</code>, <code>&#123;listing&#125;</code>,
        <code>&#123;build&#125;</code>, <code>&#123;price&#125;</code>, <code>&#123;text&#125;</code>.
      </p>

      @if (loading()) {
        <div class="center"><mat-spinner></mat-spinner></div>
      } @else if (rules.length === 0) {
        <div class="empty">No rules yet. Click <b>Add rule</b> to create one.</div>
      } @else {
        <div class="rules-list">
          @for (r of rules; track r.id) {
            <div class="rule-card" [class.disabled]="!r.enabled">
              <div class="rule-head">
                <mat-form-field appearance="outline" class="order-field" subscriptSizing="dynamic">
                  <mat-label>#</mat-label>
                  <input matInput type="number" [(ngModel)]="r.orderIndex" (change)="dirty(r)" />
                </mat-form-field>
                <mat-form-field appearance="outline" class="name-field" subscriptSizing="dynamic">
                  <mat-label>Name</mat-label>
                  <input matInput [(ngModel)]="r.name" (input)="dirty(r)" />
                </mat-form-field>
                <mat-slide-toggle [(ngModel)]="r.enabled" (change)="dirty(r)">Enabled</mat-slide-toggle>
                <span class="spacer"></span>
                @if (r.lastFiredDate) {
                  <span class="last-fired" matTooltip="Last time this rule fired">
                    <mat-icon>schedule</mat-icon>
                    {{ r.lastFiredDate | date:'MMM d, h:mm a' }}
                  </span>
                }
                <button mat-icon-button color="warn" matTooltip="Delete rule" (click)="del(r)">
                  <mat-icon>delete</mat-icon>
                </button>
              </div>

              <div class="rule-body">
                <div class="match-row">
                  <mat-form-field appearance="outline" class="match-type" subscriptSizing="dynamic">
                    <mat-label>Match</mat-label>
                    <mat-select [(ngModel)]="r.matchType" (selectionChange)="dirty(r)">
                      <mat-option value="contains">Contains</mat-option>
                      <mat-option value="equals">Equals</mat-option>
                      <mat-option value="regex">Regex</mat-option>
                      <mat-option value="any">Any message</mat-option>
                    </mat-select>
                  </mat-form-field>
                  @if (r.matchType !== 'any') {
                    <mat-form-field appearance="outline" class="match-text" subscriptSizing="dynamic">
                      <mat-label>Match text</mat-label>
                      <input matInput
                             [placeholder]="matchPlaceholder(r.matchType)"
                             [(ngModel)]="r.matchText" (input)="dirty(r)" />
                    </mat-form-field>
                  }
                  <mat-form-field appearance="outline" class="cooldown" subscriptSizing="dynamic"
                                  matTooltip="Minutes to wait before this rule can fire again on the same thread.">
                    <mat-label>Cooldown (min)</mat-label>
                    <input matInput type="number" min="0" [(ngModel)]="r.cooldownMinutes" (input)="dirty(r)" />
                  </mat-form-field>
                  <mat-checkbox [(ngModel)]="r.requireLinkedBuild" (change)="dirty(r)"
                                matTooltip="Only fire when the thread is linked to a build.">
                    Linked builds only
                  </mat-checkbox>
                </div>

                <mat-form-field appearance="outline" class="response-field" subscriptSizing="dynamic">
                  <mat-label>Response</mat-label>
                  <textarea matInput rows="3"
                            [(ngModel)]="r.responseText" (input)="dirty(r)"
                            placeholder="Yes, still available! When would you like to pick up?"></textarea>
                </mat-form-field>

                <div class="test-row">
                  <mat-form-field appearance="outline" class="test-input" subscriptSizing="dynamic">
                    <mat-label>Test text (won't send)</mat-label>
                    <input matInput [(ngModel)]="testText[r.id]"
                           (keydown.enter)="testMatch(r)" placeholder="Is this still available?" />
                  </mat-form-field>
                  <button mat-stroked-button (click)="testMatch(r)">
                    <mat-icon>science</mat-icon> Test match
                  </button>
                  @if (testResult[r.id] !== undefined) {
                    <span class="test-result" [class.hit]="testResult[r.id]" [class.miss]="!testResult[r.id]">
                      {{ testResult[r.id] ? 'Would match' : 'No match' }}
                    </span>
                  }
                  <span class="spacer"></span>
                  <button mat-flat-button color="primary"
                          [disabled]="!isDirty(r) || savingId() === r.id"
                          (click)="save(r)">
                    @if (savingId() === r.id) {
                      <mat-spinner diameter="16"></mat-spinner>
                    } @else {
                      <mat-icon>save</mat-icon>
                    }
                    Save
                  </button>
                </div>
              </div>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .rules-page { max-width: 960px; margin: 0 auto; padding: 12px; }
    .header-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .header-row h1 { margin: 0; font-size: 20px; }
    .spacer { flex: 1; }
    .hint { color: #666; font-size: 13px; margin-bottom: 16px; }
    .center { display: flex; justify-content: center; padding: 48px; }
    .empty { text-align: center; padding: 48px; color: #888; }
    .rules-list { display: flex; flex-direction: column; gap: 12px; }
    .rule-card {
      background: #fff;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      padding: 12px 14px;
      transition: opacity 120ms;
    }
    .rule-card.disabled { opacity: 0.6; }
    .rule-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
    .order-field { width: 68px; }
    .name-field { flex: 1; min-width: 200px; }
    .rule-body { display: flex; flex-direction: column; gap: 10px; }
    .match-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .match-type { width: 140px; }
    .match-text { flex: 1; min-width: 220px; }
    .cooldown { width: 140px; }
    .response-field { width: 100%; }
    .test-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .test-input { flex: 1; min-width: 240px; }
    .test-result { font-weight: 600; font-size: 13px; padding: 3px 10px; border-radius: 10px; }
    .test-result.hit { background: #c8e6c9; color: #1b5e20; }
    .test-result.miss { background: #ffcdd2; color: #b71c1c; }
    .last-fired {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: #888;
      font-size: 12px;
    }
    .last-fired mat-icon { font-size: 14px; width: 14px; height: 14px; }
  `]
})
export class MessengerRulesComponent implements OnInit {
  rules: MessengerRule[] = [];
  loading = signal(true);
  savingId = signal<number | null>(null);
  testText: Record<number, string> = {};
  testResult: Record<number, boolean> = {};

  /** Tracks per-rule dirty state so Save button only lights up on real edits. */
  private originals = new Map<number, string>();

  constructor(private api: ApiService, private snack: MatSnackBar) {}

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.api.getMessengerRules().subscribe({
      next: (rules) => {
        this.rules = (rules ?? []).sort((a, b) =>
          (a.orderIndex - b.orderIndex) || (a.id - b.id));
        this.originals.clear();
        for (const r of this.rules) this.originals.set(r.id, this.canonical(r));
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  addNew(): void {
    // POST an empty-ish placeholder rule, then focus the new row for editing.
    const draft: Partial<MessengerRule> = {
      name: 'New rule',
      enabled: false,
      matchType: 'contains',
      matchText: 'available',
      responseText: 'Yes, still available!',
      orderIndex: (this.rules.at(-1)?.orderIndex ?? 0) + 10,
      cooldownMinutes: 30,
      requireLinkedBuild: false
    };
    this.api.createMessengerRule(draft).subscribe({
      next: (created) => {
        this.rules.push(created);
        this.originals.set(created.id, this.canonical(created));
      },
      error: (err) => this.snack.open(
        'Failed to add: ' + (err?.error?.message || err?.message), 'Dismiss')
    });
  }

  dirty(_r: MessengerRule): void { /* template hook — isDirty reads from originals */ }

  isDirty(r: MessengerRule): boolean {
    return this.originals.get(r.id) !== this.canonical(r);
  }

  save(r: MessengerRule): void {
    if (!this.isDirty(r)) return;
    this.savingId.set(r.id);
    this.api.updateMessengerRule(r.id, r).subscribe({
      next: (updated) => {
        Object.assign(r, updated);
        this.originals.set(r.id, this.canonical(r));
        this.savingId.set(null);
        this.snack.open('Saved.', undefined, { duration: 1600 });
      },
      error: (err) => {
        this.savingId.set(null);
        this.snack.open(
          'Save failed: ' + (err?.error?.message || err?.message || 'unknown'),
          'Dismiss');
      }
    });
  }

  del(r: MessengerRule): void {
    if (!confirm(`Delete rule "${r.name}"?`)) return;
    this.api.deleteMessengerRule(r.id).subscribe({
      next: () => {
        this.rules = this.rules.filter(x => x.id !== r.id);
        this.originals.delete(r.id);
      },
      error: (err) => this.snack.open(
        'Delete failed: ' + (err?.error?.message || err?.message), 'Dismiss')
    });
  }

  testMatch(r: MessengerRule): void {
    const text = this.testText[r.id] ?? '';
    if (!text) return;
    this.api.testMessengerRuleMatch(r, text).subscribe({
      next: (res) => this.testResult[r.id] = res.matches,
      error: (err) => this.snack.open(
        'Test failed: ' + (err?.error?.message || err?.message), 'Dismiss')
    });
  }

  matchPlaceholder(type: MessengerRuleMatchType): string {
    switch (type) {
      case 'contains': return 'e.g. available';
      case 'equals':   return 'e.g. hi';
      case 'regex':    return 'e.g. \\b(price|cost)\\b';
      default:         return '';
    }
  }

  private canonical(r: MessengerRule): string {
    // JSON serialization on the fields that map to server-side validation.
    return JSON.stringify({
      name: r.name, enabled: r.enabled, matchType: r.matchType,
      matchText: r.matchText ?? '', responseText: r.responseText,
      orderIndex: r.orderIndex, cooldownMinutes: r.cooldownMinutes,
      requireLinkedBuild: !!r.requireLinkedBuild
    });
  }
}
