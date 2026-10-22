import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { Part } from '../../models';
import { partDisplayLabel } from '../../part-display';

export interface SplitPartDialogData {
  part: Part;
}

export interface SplitPartDialogResult {
  quantity: number;
  modelNumber: string;
}

@Component({
  selector: 'app-split-part-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>Split bulk purchase</h2>
    <mat-dialog-content>
      <p class="hint">{{ label }}</p>
      <p class="hint">
        Total cost: <strong>{{ part.cost != null ? (part.cost | currency) : '—' }}</strong>
        → each unit will share this total (penny remainders distributed so costs sum exactly).
      </p>
      <mat-form-field appearance="outline" class="field">
        <mat-label>Part name (model)</mat-label>
        <input matInput [(ngModel)]="modelNumber" maxlength="100" required>
        <mat-hint>Applied to every part created by this split</mat-hint>
      </mat-form-field>
      <mat-form-field appearance="outline" class="field">
        <mat-label>Split into how many parts?</mat-label>
        <input matInput type="number" min="2" max="500" step="1"
               [(ngModel)]="quantity" (keyup.enter)="save()">
        <mat-hint>Creates this many rows (2–500), each as a single unit</mat-hint>
      </mat-form-field>
      @if (previewText) {
        <p class="preview">{{ previewText }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button color="primary" [disabled]="!valid" (click)="save()">Split</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .hint { margin: 0 0 8px; color: #666; font-size: 13px; }
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
  `]
})
export class SplitPartDialogComponent {
  part: Part;
  label: string;
  quantity: number | null = null;
  modelNumber = '';

  constructor(
    public dialogRef: MatDialogRef<SplitPartDialogComponent, SplitPartDialogResult | undefined>,
    @Inject(MAT_DIALOG_DATA) data: SplitPartDialogData
  ) {
    this.part = data.part;
    this.label = partDisplayLabel(data.part);
    this.modelNumber = data.part.modelNumber?.trim() ?? '';
  }

  get valid(): boolean {
    const q = Number(this.quantity);
    return Number.isInteger(q)
      && q >= 2
      && q <= 500
      && this.part.cost != null
      && !!this.modelNumber.trim();
  }

  get previewText(): string | null {
    if (!this.valid || this.part.cost == null) return null;
    const q = Number(this.quantity);
    const totalCents = Math.round(this.part.cost * 100);
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
    this.dialogRef.close({
      quantity: Number(this.quantity),
      modelNumber: this.modelNumber.trim()
    });
  }
}
