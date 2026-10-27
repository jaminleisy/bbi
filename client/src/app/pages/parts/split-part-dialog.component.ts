import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS, MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { Part } from '../../models';
import { PART_TYPE_ORDER, partDisplayLabel, partTypeLabel } from '../../part-display';

export type SplitMode = 'quantity' | 'pc';

export interface SplitPartDialogData {
  part: Part;
  types?: string[];
}

export interface SplitPcPartInput {
  type: string;
  manufacturer: string;
  modelNumber: string;
  cost: number;
  color?: string | null;
}

export type SplitPartDialogResult =
  | { mode: 'quantity'; quantity: number; modelNumber: string }
  | { mode: 'pc'; parts: SplitPcPartInput[] };

interface PcSplitRow {
  type: string;
  manufacturer: string;
  modelNumber: string;
  cost: number | null;
  color: string;
}

@Component({
  selector: 'app-split-part-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatButtonToggleModule
  ],
  providers: [
    { provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { appearance: 'outline', subscriptSizing: 'dynamic' } }
  ],
  template: `
    <h2 mat-dialog-title>Split part</h2>
    <mat-dialog-content>
      <p class="hint">{{ label }}</p>
      <p class="hint">
        Original cost: <strong>{{ part.cost != null ? (part.cost | currency) : '—' }}</strong>
      </p>

      <mat-button-toggle-group class="mode-toggle" [value]="mode" (change)="setMode($event.value)">
        <mat-button-toggle value="quantity">Quantity Split</mat-button-toggle>
        <mat-button-toggle value="pc">Complete PC Split</mat-button-toggle>
      </mat-button-toggle-group>

      @if (mode === 'quantity') {
        <p class="hint">
          Each unit will share this total (penny remainders distributed so costs sum exactly).
        </p>
        <mat-form-field class="field">
          <mat-label>Part name (model)</mat-label>
          <input matInput [(ngModel)]="modelNumber" maxlength="100" required>
          <mat-hint>Applied to every part created by this split</mat-hint>
        </mat-form-field>
        <mat-form-field class="field">
          <mat-label>Split into how many parts?</mat-label>
          <input matInput type="number" min="2" max="500" step="1"
                 [(ngModel)]="quantity" (keyup.enter)="save()">
          <mat-hint>Creates this many rows (2–500), each as a single unit</mat-hint>
        </mat-form-field>
        @if (previewText) {
          <p class="preview">{{ previewText }}</p>
        }
      } @else {
        <p class="hint">
          Enter the parts inside this prebuilt. Leave a type blank to skip it.
          Each filled part needs a manufacturer, model, and cost.
          New parts keep the original order date, seller, order URL, condition,
          location, return-by date, merchant, received, and tested status.
          The original part is removed.
        </p>
        <div class="pc-grid">
          <div class="pc-head">Type</div>
          <div class="pc-head">Manufacturer</div>
          <div class="pc-head">Model</div>
          <div class="pc-head">Cost</div>
          <div class="pc-head">Color</div>
          @for (row of rows; track row.type) {
            <div class="pc-type" [class.filled]="!isRowBlank(row)" [class.incomplete]="isRowIncomplete(row)"
                 [title]="typeLabel(row.type)">
              {{ typeLabel(row.type) }}
            </div>
            <mat-form-field>
              <input matInput [(ngModel)]="row.manufacturer" maxlength="100" [attr.aria-label]="typeLabel(row.type) + ' manufacturer'">
            </mat-form-field>
            <mat-form-field>
              <input matInput [(ngModel)]="row.modelNumber" maxlength="100" [attr.aria-label]="typeLabel(row.type) + ' model'">
            </mat-form-field>
            <mat-form-field>
              <input matInput type="number" min="0" step="0.01" [(ngModel)]="row.cost"
                     [attr.aria-label]="typeLabel(row.type) + ' cost'">
              <span matTextPrefix>$&nbsp;</span>
            </mat-form-field>
            <mat-form-field>
              <input matInput [(ngModel)]="row.color" maxlength="50" [attr.aria-label]="typeLabel(row.type) + ' color'">
            </mat-form-field>
          }
        </div>
        <div class="pc-totals">
          <span>Entered: <strong>{{ enteredTotal | currency }}</strong></span>
          <span>Original: <strong>{{ part.cost != null ? (part.cost | currency) : '—' }}</strong></span>
          @if (costDeltaCents !== 0 && filledRows.length) {
            <span class="warn">
              {{ costDeltaCents > 0 ? 'Over by' : 'Short by' }}
              <strong>{{ costDeltaAbs | currency }}</strong>
            </span>
          }
        </div>
        @if (pcWarning) {
          <p class="warn-text">{{ pcWarning }}</p>
        }
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button color="primary" [disabled]="!valid" (click)="save()">Split</button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content { overflow-x: auto; }
    .hint { margin: 0 0 8px; color: #666; font-size: 13px; }
    .mode-toggle {
      display: flex;
      width: 100%;
      margin: 4px 0 16px;
    }
    .mode-toggle mat-button-toggle { flex: 1; }
    .field {
      width: 100%;
      display: block;
      margin-bottom: 20px;
    }
    .preview {
      margin: 16px 0 4px;
      font-size: 13px;
      color: #1565c0;
      line-height: 1.4;
    }
    .pc-grid {
      display: grid;
      grid-template-columns: 108px minmax(110px, 1fr) minmax(110px, 1fr) 110px 88px;
      column-gap: 8px;
      row-gap: 6px;
      align-items: center;
      min-width: 560px;
    }
    .pc-grid mat-form-field { width: 100%; }
    .pc-head {
      font-size: 12px;
      font-weight: 600;
      color: #555;
      padding-bottom: 2px;
    }
    .pc-type {
      font-size: 13px;
      font-weight: 600;
      color: #666;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pc-type.filled { color: #333; }
    .pc-type.incomplete { color: #c62828; }
    .pc-totals {
      display: flex;
      flex-wrap: wrap;
      gap: 12px 20px;
      margin-top: 14px;
      font-size: 13px;
      color: #444;
    }
    .warn { color: #c62828; }
    .warn-text {
      margin: 10px 0 0;
      font-size: 13px;
      color: #c62828;
      line-height: 1.4;
    }
  `]
})
export class SplitPartDialogComponent {
  part: Part;
  label: string;
  mode: SplitMode = 'quantity';
  quantity: number | null = null;
  modelNumber = '';
  rows: PcSplitRow[] = [];

  constructor(
    public dialogRef: MatDialogRef<SplitPartDialogComponent, SplitPartDialogResult | undefined>,
    @Inject(MAT_DIALOG_DATA) data: SplitPartDialogData
  ) {
    this.part = data.part;
    this.label = partDisplayLabel(data.part);
    this.modelNumber = data.part.modelNumber?.trim() ?? '';
    const types = (data.types?.length ? data.types : [...PART_TYPE_ORDER]);
    this.rows = types.map(type => ({
      type,
      manufacturer: '',
      modelNumber: '',
      cost: null,
      color: ''
    }));
  }

  setMode(mode: SplitMode): void {
    this.mode = mode;
    this.dialogRef.updateSize(mode === 'pc' ? 'min(880px, 96vw)' : '400px');
  }

  typeLabel(type: string): string {
    return partTypeLabel(type);
  }

  isRowBlank(row: PcSplitRow): boolean {
    return !row.manufacturer.trim()
      && !row.modelNumber.trim()
      && !row.color.trim()
      && !this.hasCost(row.cost);
  }

  isRowComplete(row: PcSplitRow): boolean {
    return !!row.manufacturer.trim()
      && !!row.modelNumber.trim()
      && this.hasCost(row.cost);
  }

  isRowIncomplete(row: PcSplitRow): boolean {
    return !this.isRowBlank(row) && !this.isRowComplete(row);
  }

  get filledRows(): PcSplitRow[] {
    return this.rows.filter(r => !this.isRowBlank(r));
  }

  get enteredTotalCents(): number {
    return this.filledRows.reduce((sum, row) => sum + this.toCents(Number(row.cost)), 0);
  }

  get enteredTotal(): number {
    return this.enteredTotalCents / 100;
  }

  get costDeltaCents(): number {
    if (this.part.cost == null) return 0;
    return this.enteredTotalCents - this.toCents(this.part.cost);
  }

  get costDeltaAbs(): number {
    return Math.abs(this.costDeltaCents) / 100;
  }

  get costsMatch(): boolean {
    return this.part.cost != null
      && this.filledRows.length > 0
      && this.costDeltaCents === 0;
  }

  get pcWarning(): string | null {
    if (this.mode !== 'pc') return null;
    if (!this.filledRows.length) return null;
    if (this.filledRows.some(r => this.isRowIncomplete(r))) {
      return 'Every part that is not left blank needs a manufacturer, model, and cost.';
    }
    if (this.filledRows.some(r => Number(r.cost) < 0)) {
      return 'Part costs cannot be negative.';
    }
    if (this.part.cost == null) return 'Part must have a cost before it can be split.';
    if (!this.costsMatch) {
      return 'Part costs must add up to the original part cost before you can split.';
    }
    return null;
  }

  get valid(): boolean {
    if (this.part.cost == null) return false;
    if (this.mode === 'quantity') {
      const q = Number(this.quantity);
      return Number.isInteger(q)
        && q >= 2
        && q <= 500
        && !!this.modelNumber.trim();
    }
    return this.filledRows.length > 0
      && this.filledRows.every(r => this.isRowComplete(r) && Number(r.cost) >= 0)
      && this.costsMatch;
  }

  get previewText(): string | null {
    if (this.mode !== 'quantity' || !this.valid || this.part.cost == null) return null;
    const q = Number(this.quantity);
    const totalCents = this.toCents(this.part.cost);
    const base = Math.floor(totalCents / q);
    const rem = totalCents % q;
    const lower = (base / 100).toFixed(2);
    const name = this.modelNumber.trim();
    if (rem === 0) return `${q} × ${name} @ $${lower}`;
    const higher = ((base + 1) / 100).toFixed(2);
    return `${rem} × ${name} @ $${higher}, ${q - rem} × $${lower}`;
  }

  save(): void {
    if (!this.valid) return;
    if (this.mode === 'quantity') {
      this.dialogRef.close({
        mode: 'quantity',
        quantity: Number(this.quantity),
        modelNumber: this.modelNumber.trim()
      });
      return;
    }
    this.dialogRef.close({
      mode: 'pc',
      parts: this.filledRows.map(row => ({
        type: row.type,
        manufacturer: row.manufacturer.trim(),
        modelNumber: row.modelNumber.trim(),
        cost: this.round2(Number(row.cost)),
        color: row.color.trim() || null
      }))
    });
  }

  private hasCost(cost: number | null): boolean {
    return cost != null && `${cost}` !== '' && !Number.isNaN(Number(cost));
  }

  private round2(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private toCents(value: number): number {
    return Math.round(value * 100);
  }
}
