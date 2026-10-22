import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { Lookups, Part } from '../../models';
import { partDisplayLabel, partTypeLabel, sortTypeNames } from '../../part-display';
import { CheckOffDialogComponent, CheckOffDialogData } from './check-off-dialog.component';

type CheckOffMode = 'notReceived' | 'untested' | 'transfer';
/** Specific required type name, or `'other'` for non-required types. */
type TypeFilter = string;

@Component({
  selector: 'app-parts-check-off',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatButtonModule, MatButtonToggleModule, MatFormFieldModule,
    MatSelectModule, MatIconModule, MatProgressSpinnerModule, MatDialogModule, MatSnackBarModule
  ],
  template: `
    <div class="page-container">
      <div class="header-row">
        <h1>Parts Check Off</h1>
      </div>

      <div class="controls">
        <mat-form-field appearance="outline" class="location-field">
          <mat-label>Location</mat-label>
          <mat-select [(ngModel)]="location" (selectionChange)="load()">
            @for (l of lookups?.locations ?? []; track l) {
              <mat-option [value]="l">{{ l }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-button-toggle-group class="mode-toggles" [(ngModel)]="mode" (ngModelChange)="load()"
                                 aria-label="Check-off mode">
          <mat-button-toggle value="notReceived">Not Yet Received</mat-button-toggle>
          <mat-button-toggle value="untested">Untested</mat-button-toggle>
          <mat-button-toggle value="transfer">Transfer</mat-button-toggle>
        </mat-button-toggle-group>

        <mat-form-field appearance="outline" class="type-filter-field">
          <mat-label>Part type</mat-label>
          <mat-select [(ngModel)]="typeFilter">
            <mat-option value="all">All</mat-option>
            @for (t of requiredTypeOptions; track t) {
              <mat-option [value]="t">{{ typeLabel(t) }}</mat-option>
            }
            <mat-option value="other">Other</mat-option>
          </mat-select>
        </mat-form-field>
      </div>

      @if (loading) {
        <div class="center"><mat-spinner></mat-spinner></div>
      } @else if (!location) {
        <div class="empty">Select a location to see parts.</div>
      } @else if (displayedParts.length === 0) {
        <div class="empty">
          @if (parts.length === 0) {
            @if (mode === 'notReceived') {
              No unreceived parts at {{ location }}.
            } @else if (mode === 'untested') {
              No received used parts awaiting testing at {{ location }}.
            } @else {
              No parts needing transfer at {{ location }}.
            }
          } @else if (typeFilter === 'other') {
            No other-type parts in this list.
          } @else if (typeFilter === 'all') {
            No parts in this list.
          } @else {
            No {{ typeLabel(typeFilter) }} parts in this list.
          }
        </div>
      } @else {
        <div class="list">
          @for (p of displayedParts; track p.id) {
            <button type="button" class="part-card" (click)="openPart(p)">
              <div class="part-title">
                <strong>{{ p.type }}</strong>
                <span>{{ partDisplayLabel(p) }}</span>
              </div>
              <div class="part-meta">
                @if (mode === 'transfer') {
                  <span class="transfer-locs">
                    <span class="loc-from">{{ p.location || '(none)' }}</span>
                    <mat-icon class="transfer-arrow">arrow_forward</mat-icon>
                    <span class="loc-to">{{ p.computerLocation || '(none)' }}</span>
                  </span>
                  <span>
                    <mat-icon>computer</mat-icon>
                    {{ p.computerName || 'Unknown build' }}
                  </span>
                } @else {
                  <span>
                    <mat-icon>event</mat-icon>
                    {{ p.orderDate ? (p.orderDate | date:'M/d/yyyy') : 'No order date' }}
                  </span>
                  @if (p.seller) {
                    <span>
                      <mat-icon>storefront</mat-icon>
                      {{ p.seller }}
                    </span>
                  }
                  @if (p.condition) {
                    <span>
                      <mat-icon>label</mat-icon>
                      {{ p.condition }}
                    </span>
                  }
                }
              </div>
              <mat-icon class="chevron">chevron_right</mat-icon>
            </button>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .header-row { margin-bottom: 8px; }
    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      margin-bottom: 16px;
    }
    .location-field { width: 180px; }
    .type-filter-field { width: 180px; }
    .center { display: flex; justify-content: center; padding: 48px; }
    .empty { text-align: center; color: #777; padding: 48px 16px; }
    .list { display: flex; flex-direction: column; gap: 8px; max-width: 720px; }
    .part-card {
      position: relative;
      display: block;
      width: 100%;
      text-align: left;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      background: #fff;
      padding: 12px 40px 12px 14px;
      cursor: pointer;
      font: inherit;
      box-shadow: 0 1px 2px rgba(0,0,0,0.06);
    }
    .part-card:hover { border-color: #90caf9; background: #fafcff; }
    .part-title {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin-bottom: 8px;
    }
    .part-title strong {
      text-transform: uppercase;
      font-size: 12px;
      color: #1565c0;
      letter-spacing: 0.03em;
    }
    .part-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      font-size: 13px;
      color: #666;
    }
    .part-meta span {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .part-meta mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .transfer-locs {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-weight: 600;
    }
    .loc-from { color: #c62828; }
    .loc-to { color: #2e7d32; }
    .transfer-arrow {
      font-size: 18px !important;
      width: 18px !important;
      height: 18px !important;
      color: #757575;
    }
    .chevron {
      position: absolute;
      right: 8px;
      top: 50%;
      transform: translateY(-50%);
      color: #999;
    }
    @media (max-width: 599px) {
      .controls { align-items: stretch; }
      .location-field,
      .type-filter-field,
      .mode-toggles { width: 100%; }
      .type-filter-field { order: 3; }
      .mode-toggles { order: 2; }
      .location-field { order: 1; }
      :host ::ng-deep .mat-button-toggle { flex: 1; }
    }
  `]
})
export class PartsCheckOffComponent implements OnInit {
  partDisplayLabel = partDisplayLabel;
  lookups: Lookups | null = null;
  location = '';
  mode: CheckOffMode = 'notReceived';
  typeFilter: TypeFilter = 'all';
  requiredTypeOptions: string[] = [];
  parts: Part[] = [];
  loading = true;
  private requiredTypes = new Set<string>();

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private dialog: MatDialog,
    private snack: MatSnackBar
  ) {}

  get displayedParts(): Part[] {
    if (this.typeFilter === 'all' || !this.typeFilter) return this.parts;
    if (this.typeFilter === 'other') {
      return this.parts.filter(p => !this.requiredTypes.has(p.type));
    }
    return this.parts.filter(p => p.type === this.typeFilter);
  }

  typeLabel(type: string): string {
    return partTypeLabel(type);
  }

  ngOnInit(): void {
    this.api.getLookups().subscribe({
      next: l => {
        this.lookups = l;
        this.requiredTypeOptions = sortTypeNames(
          (l.types ?? []).filter(t => t.required).map(t => t.type)
        );
        this.requiredTypes = new Set(this.requiredTypeOptions);
        this.typeFilter = 'all';
        this.location = this.defaultLocation(l.locations ?? []);
        this.load();
      },
      error: () => {
        this.loading = false;
        this.snack.open('Failed to load locations', 'OK');
      }
    });
  }

  private defaultLocation(locations: string[]): string {
    const preferred = this.auth.currentUser()?.name === 'Josh B' ? 'Josh' : 'Ben';
    if (locations.includes(preferred)) return preferred;
    return locations[0] ?? '';
  }

  load(): void {
    if (!this.location) {
      this.parts = [];
      this.loading = false;
      return;
    }
    this.loading = true;
    const filters: Record<string, string | boolean | undefined> = {
      location: this.location
    };
    if (this.mode === 'notReceived') filters['notReceived'] = true;
    else if (this.mode === 'untested') filters['needsTesting'] = true;
    else filters['needsTransfer'] = true;

    this.api.getParts(filters).subscribe({
      next: parts => {
        this.parts = [...parts].sort((a, b) => {
          if (this.mode === 'transfer') {
            const buildCmp = (a.computerName ?? '').localeCompare(b.computerName ?? '', undefined, {
              sensitivity: 'base'
            });
            if (buildCmp !== 0) return buildCmp;
            const typeCmp = a.type.localeCompare(b.type, undefined, { sensitivity: 'base' });
            if (typeCmp !== 0) return typeCmp;
            return a.id - b.id;
          }
          const at = a.orderDate ? Date.parse(a.orderDate) : Number.POSITIVE_INFINITY;
          const bt = b.orderDate ? Date.parse(b.orderDate) : Number.POSITIVE_INFINITY;
          if (at !== bt) return at - bt;
          return a.id - b.id;
        });
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.snack.open('Failed to load parts', 'OK');
      }
    });
  }

  openPart(part: Part): void {
    // MatDialog locks body scroll on mobile; closing often jumps to top.
    // Also, removing the focused card after check-off drops focus and can scroll up.
    const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
    const data: CheckOffDialogData = {
      part,
      mode: this.mode
    };
    const ref = this.dialog.open(CheckOffDialogComponent, {
      data,
      width: '480px',
      maxWidth: '95vw',
      maxHeight: '90vh',
      autoFocus: false,
      restoreFocus: false
    });
    ref.afterClosed().subscribe(changed => {
      if (changed) {
        (document.activeElement as HTMLElement | null)?.blur?.();
        this.parts = this.parts.filter(p => p.id !== part.id);
      }
      this.restoreScroll(scrollY);
    });
  }

  private restoreScroll(y: number): void {
    const apply = () => window.scrollTo(0, y);
    requestAnimationFrame(() => {
      apply();
      // Second pass after Material overlay teardown / focus changes settle (esp. mobile).
      setTimeout(apply, 0);
    });
  }
}
