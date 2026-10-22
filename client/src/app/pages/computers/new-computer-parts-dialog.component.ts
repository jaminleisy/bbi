import {
  AfterViewInit, Component, ElementRef, Inject, OnInit, QueryList, ViewChildren
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ApiService } from '../../services/api.service';
import { Lookups, Part } from '../../models';
import { comparePartTypes, confirmReassignFromPlanned, isScamPart, isUsedUntested, openPartOrderUrl, partDisplayLabel } from '../../part-display';

export interface NewComputerPartsResult {
  partIds: number[];
  /** Planned computers that selected parts are being taken from. */
  takenFromIds: number[];
}

interface PartSlot {
  type: string;
  label: string;
  query: string;
  selected: Part | null;
  highlight: number;
}

const TYPE_LABELS: Record<string, string> = {
  case: 'Case',
  psu: 'PSU',
  gpu: 'GPU',
  mobo: 'Motherboard',
  cpu: 'CPU',
  cpuCooler: 'CPU Cooler',
  storage: 'Storage',
  ram: 'RAM'
};

@Component({
  selector: 'app-new-computer-parts-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule, MatSnackBarModule],
  template: `
    <h2 mat-dialog-title>New Computer — Select Parts</h2>
    <mat-dialog-content>
      <p class="hint">
        Pick each required part. Type to filter, use ↑ ↓ and Enter to select — then the next field is focused.
      </p>
      <label class="show-planned">
        <input type="checkbox" [(ngModel)]="showPlanned">
        Show parts assigned to planned PCs
      </label>

      @if (loading) {
        <div class="center"><mat-spinner diameter="36"></mat-spinner></div>
      } @else {
        <div class="slots">
          @for (slot of slots; track slot.type; let i = $index) {
            <div class="slot" [class.active-slot]="activeIndex === i">
              <label class="slot-label" [attr.for]="'part-slot-' + i">{{ slot.label }}</label>
              <div class="combo" [class.combo-open]="activeIndex === i && dropdownOpen">
                <input
                  class="slot-input"
                  [id]="'part-slot-' + i"
                  #slotInput
                  [(ngModel)]="slot.query"
                  (ngModelChange)="onQueryChange(i)"
                  (keydown)="onKeydown($event, i)"
                  (focus)="onFocus(i)"
                  (blur)="onBlur(i)"
                  autocomplete="off"
                  spellcheck="false">
                @if (slot.query) {
                  <button type="button" class="clear-btn" mat-icon-button
                          (mousedown)="$event.preventDefault()"
                          (click)="clearSlot(i)"
                          aria-label="Clear search">
                    <mat-icon>close</mat-icon>
                  </button>
                }
                @if (activeIndex === i && dropdownOpen && filteredFor(i).length) {
                  <ul class="suggestions" role="listbox">
                    @for (p of filteredFor(i); track p.id; let j = $index) {
                      <li role="option"
                          [class.highlighted]="j === slot.highlight"
                          (mousedown)="onSuggestionMouseDown($event, i, p)">
                        <span class="part-main">
                          {{ partLabel(p) }}
                          @if (isUsedUntested(p)) {
                            <mat-icon class="needs-test-icon" matTooltip="Used — needs testing">pending_actions</mat-icon>
                          }
                        </span>
                        @if (p.location) {
                          <span class="part-location">{{ p.location }}</span>
                        }
                        @if (p.cost != null) {
                          <span class="part-meta">{{ p.cost | currency }}</span>
                        }
                        @if (!p.received) {
                          <span class="warn">not received</span>
                        }
                        @if (p.computerId != null) {
                          <span class="planned-on">On planned: {{ p.computerName }}</span>
                        }
                      </li>
                    }
                  </ul>
                }
              </div>
              <div class="slot-status">
                @if (slot.selected) {
                  <div class="selected-line">
                    <mat-icon class="ok">check_circle</mat-icon>
                    <span class="selected-label">{{ partLabel(slot.selected) }}</span>
                    @if (slot.selected.location) {
                      <span class="part-location">{{ slot.selected.location }}</span>
                    }
                  </div>
                } @else if (activeIndex === i && slot.query.trim() && !filteredFor(i).length) {
                  <div class="empty-line">No matching unassigned {{ slot.label }} parts</div>
                }
              </div>
            </div>
          }
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button color="primary" [disabled]="loading" (click)="continueToForm()">
        Continue
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    :host {
      display: block;
      max-height: inherit;
    }
    .hint { margin: 0 0 16px; color: #666; font-size: 13px; line-height: 1.4; }
    .center { display: flex; justify-content: center; padding: 32px; }
    .slots {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
      width: 100%;
      max-width: 560px;
      position: relative;
      /* Leave room so the last field's suggestion list isn't clipped */
      padding-bottom: 240px;
    }
    .slot {
      position: relative;
      z-index: 1;
    }
    .slot.active-slot { z-index: 10; }
    .slot-label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: #555;
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .combo { position: relative; }
    .combo-open { z-index: 11; }
    .slot-input {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #c4c4c4;
      border-radius: 4px;
      padding: 10px 36px 10px 12px;
      font-size: 15px;
      outline: none;
      background: #fff;
    }
    .slot-input:focus {
      border-color: #1976d2;
      box-shadow: 0 0 0 1px #1976d2;
    }
    .active-slot .slot-label { color: #1565c0; }
    .clear-btn {
      position: absolute;
      right: 2px;
      top: 50%;
      transform: translateY(-50%);
      width: 32px;
      height: 32px;
      padding: 0;
      z-index: 2;
    }
    .suggestions {
      position: absolute;
      left: 0;
      right: 0;
      top: calc(100% + 2px);
      z-index: 20;
      margin: 0;
      padding: 4px 0;
      list-style: none;
      background: #fff;
      border: 1px solid #bdbdbd;
      border-radius: 4px;
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.18);
      max-height: 200px;
      overflow-y: auto;
    }
    .suggestions li {
      display: flex;
      align-items: baseline;
      gap: 8px;
      padding: 8px 12px;
      cursor: pointer;
      font-size: 14px;
    }
    .suggestions li.highlighted,
    .suggestions li:hover { background: #e3f2fd; }
    .part-main {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
    }
    .needs-test-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: #ef6c00;
      flex-shrink: 0;
    }
    .part-meta { color: #666; font-size: 13px; flex-shrink: 0; }
    .part-location {
      flex-shrink: 0;
      font-size: 11px;
      background: #e3f2fd;
      color: #1565c0;
      border-radius: 8px;
      padding: 1px 7px;
      white-space: nowrap;
    }
    .warn { color: #d32f2f; font-size: 12px; flex-shrink: 0; }
    .planned-on {
      flex-shrink: 0;
      font-size: 11px;
      background: #fff3e0;
      color: #e65100;
      border-radius: 8px;
      padding: 1px 7px;
      white-space: nowrap;
    }
    .show-planned {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin: -8px 0 12px;
      font-size: 13px;
      color: #555;
      cursor: pointer;
    }
    .slot-status { min-height: 22px; margin-top: 2px; }
    .selected-line {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      font-size: 13px;
      color: #2e7d32;
    }
    .selected-line .ok { font-size: 16px; width: 16px; height: 16px; color: #2e7d32; flex-shrink: 0; }
    .selected-label { min-width: 0; }
    .empty-line { font-size: 12px; color: #999; }
  `]
})
export class NewComputerPartsDialogComponent implements OnInit, AfterViewInit {
  @ViewChildren('slotInput') slotInputs!: QueryList<ElementRef<HTMLInputElement>>;

  slots: PartSlot[] = [];
  private allParts: Part[] = [];
  loading = true;
  showPlanned = false;
  activeIndex = 0;
  dropdownOpen = true;
  isUsedUntested = isUsedUntested;
  private blurTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    public dialogRef: MatDialogRef<NewComputerPartsDialogComponent, NewComputerPartsResult | undefined>,
    @Inject(MAT_DIALOG_DATA) public data: { lookups: Lookups },
    private api: ApiService,
    private snack: MatSnackBar
  ) {
    this.slots = [...data.lookups.types]
      .filter(t => t.required)
      .sort((a, b) => comparePartTypes(a.type, b.type))
      .map(t => ({
        type: t.type,
        label: TYPE_LABELS[t.type] ?? t.type,
        query: '',
        selected: null,
        highlight: 0
      }));
  }

  ngOnInit(): void {
    this.api.getParts({ unassigned: true, includePlanned: true, excludeBad: true, excludeScam: true }).subscribe({
      next: parts => {
        this.allParts = parts.filter(p => !isScamPart(p));
        this.loading = false;
        setTimeout(() => this.focusSlot(0), 0);
      },
      error: () => { this.loading = false; }
    });
  }

  ngAfterViewInit(): void {
    if (!this.loading) setTimeout(() => this.focusSlot(0), 0);
  }

  partLabel(p: Part): string {
    return partDisplayLabel(p, '') || `(#${p.id})`;
  }

  filteredFor(index: number): Part[] {
    const slot = this.slots[index];
    const taken = new Set(
      this.slots
        .filter((s, i) => i !== index && s.selected)
        .map(s => s.selected!.id)
    );
    const q = slot.query.toLowerCase().trim();
    // When a part is selected, query often mirrors its label — show other matches on focus/edit.
    const selectedLabel = slot.selected ? this.partLabel(slot.selected).toLowerCase() : '';
    const filterQuery = slot.selected && q === selectedLabel ? '' : q;

    return this.allParts
      .filter(p => p.type === slot.type && !taken.has(p.id))
      .filter(p => this.showPlanned || p.computerId == null)
      .filter(p => {
        if (!filterQuery) return true;
        const hay = `${p.manufacturer ?? ''} ${p.modelNumber ?? ''} ${p.color ?? ''} ${p.location ?? ''}`.toLowerCase();
        return hay.includes(filterQuery) || String(p.id).includes(filterQuery);
      })
      .slice(0, 50);
  }

  onFocus(index: number): void {
    if (this.blurTimer) {
      clearTimeout(this.blurTimer);
      this.blurTimer = null;
    }
    this.activeIndex = index;
    this.dropdownOpen = true;
    const list = this.filteredFor(index);
    const slot = this.slots[index];
    if (slot.highlight >= list.length) slot.highlight = Math.max(0, list.length - 1);
    this.scrollSlotIntoView(index);
  }

  onBlur(index: number): void {
    this.blurTimer = setTimeout(() => {
      if (this.activeIndex === index) this.dropdownOpen = false;
    }, 150);
  }

  onQueryChange(index: number): void {
    const slot = this.slots[index];
    if (slot.selected && this.partLabel(slot.selected) !== slot.query) {
      slot.selected = null;
    }
    slot.highlight = 0;
    this.dropdownOpen = true;
  }

  onKeydown(event: KeyboardEvent, index: number): void {
    const list = this.filteredFor(index);
    const slot = this.slots[index];

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.dropdownOpen = true;
      if (list.length) slot.highlight = (slot.highlight + 1) % list.length;
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.dropdownOpen = true;
      if (list.length) slot.highlight = (slot.highlight - 1 + list.length) % list.length;
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (this.dropdownOpen && list.length) {
        this.selectPart(index, list[slot.highlight] ?? list[0]);
      } else if (slot.selected) {
        this.advanceFrom(index);
      }
      return;
    }
    if (event.key === 'Escape') {
      this.dropdownOpen = false;
      return;
    }
    if (event.key === 'Tab' && !event.shiftKey && slot.selected) {
      // Let default tab move focus; keep selection.
      this.dropdownOpen = false;
    }
  }

  selectPart(index: number, part: Part): void {
    if (!confirmReassignFromPlanned(part, null)) {
      this.focusSlot(index);
      return;
    }
    const slot = this.slots[index];
    slot.selected = part;
    slot.query = this.partLabel(part);
    slot.highlight = 0;
    this.dropdownOpen = false;
    this.advanceFrom(index);
  }

  onSuggestionMouseDown(event: MouseEvent, index: number, part: Part): void {
    event.preventDefault();
    if (event.ctrlKey) {
      if (!openPartOrderUrl(part)) {
        this.snack.open('No URL', undefined, { duration: 2000 });
      }
      return;
    }
    this.selectPart(index, part);
  }

  clearSlot(index: number): void {
    const slot = this.slots[index];
    slot.selected = null;
    slot.query = '';
    slot.highlight = 0;
    this.focusSlot(index);
    this.dropdownOpen = true;
  }

  private advanceFrom(index: number): void {
    if (index + 1 < this.slots.length) {
      this.focusSlot(index + 1);
    } else {
      this.continueToForm();
    }
  }

  focusSlot(index: number): void {
    this.activeIndex = index;
    this.dropdownOpen = true;
    const inputs = this.slotInputs?.toArray() ?? [];
    const el = inputs[index]?.nativeElement;
    if (el) {
      el.focus();
      el.select();
      this.scrollSlotIntoView(index);
    }
  }

  private scrollSlotIntoView(index: number): void {
    setTimeout(() => {
      const el = this.slotInputs?.get(index)?.nativeElement;
      el?.closest('.slot')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 0);
  }

  continueToForm(): void {
    const selected = this.slots.map(s => s.selected).filter((p): p is Part => !!p);
    this.dialogRef.close({
      partIds: selected.map(p => p.id),
      takenFromIds: [...new Set(selected.filter(p => p.computerId != null).map(p => p.computerId!))]
    });
  }
}
