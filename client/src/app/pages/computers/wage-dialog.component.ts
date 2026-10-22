import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { Computer, Lookups, PAYMENT_METHODS, Wage } from '../../models';
import { computerDisplayName } from '../../part-display';

export interface WageDialogData {
  computer: Computer;
  lookups: Lookups;
  wage?: Wage | null;
}

@Component({
  selector: 'app-wage-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatDatepickerModule],
  template: `
    <h2 mat-dialog-title>{{ editing ? 'Edit Wage' : 'Add Wage' }} — {{ computerDisplayName(data.computer) }}</h2>
    <mat-dialog-content>
      <div class="wage-form">
        <mat-form-field appearance="outline">
          <mat-label>Builder</mat-label>
          <mat-select [(ngModel)]="model.builderUserId" required>
            @for (u of data.lookups.users; track u.id) {
              <mat-option [value]="u.id">{{ u.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Amount</mat-label>
          <input matInput type="number" [(ngModel)]="model.amount" required>
          <span matTextPrefix>$&nbsp;</span>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Paid date</mat-label>
          <input matInput [matDatepicker]="picker" [(ngModel)]="paidDate">
          <mat-datepicker-toggle matIconSuffix [for]="picker"></mat-datepicker-toggle>
          <mat-datepicker #picker></mat-datepicker>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Paid method</mat-label>
          <mat-select [(ngModel)]="model.paidMethod">
            <mat-option [value]="null">—</mat-option>
            @for (m of methods; track m) {
              <mat-option [value]="m">{{ m }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Notes</mat-label>
          <textarea matInput rows="2" [(ngModel)]="model.notes"></textarea>
        </mat-form-field>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button color="primary"
              [disabled]="!canSave"
              (click)="save()">
        {{ editing ? 'Save' : 'Add' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .wage-form {
      display: flex;
      flex-direction: column;
      min-width: 0;
      width: 100%;
      max-width: 380px;
      padding-top: 8px;
      box-sizing: border-box;
    }
  `]
})
export class WageDialogComponent {
  computerDisplayName = computerDisplayName;
  methods = PAYMENT_METHODS;
  editing: boolean;
  model: Partial<Wage>;
  paidDate: Date | null = null;

  constructor(
    public dialogRef: MatDialogRef<WageDialogComponent, Partial<Wage> | undefined>,
    @Inject(MAT_DIALOG_DATA) public data: WageDialogData
  ) {
    this.editing = !!data.wage;
    const w = data.wage;
    this.model = {
      id: w?.id,
      builderUserId: w?.builderUserId ?? data.computer.builderUserId ?? '',
      computerId: data.computer.id,
      amount: w?.amount,
      paidMethod: w?.paidMethod ?? null,
      notes: w?.notes ?? null
    };
    this.paidDate = w?.paidDate ? new Date(w.paidDate) : new Date();
  }

  get canSave(): boolean {
    if (!this.model.builderUserId) return false;
    const amount = Number(this.model.amount);
    return !Number.isNaN(amount);
  }

  save(): void {
    if (!this.canSave) return;
    this.dialogRef.close({
      ...this.model,
      amount: Number(this.model.amount),
      computerId: this.data.computer.id,
      paidDate: this.paidDate ? this.paidDate.toISOString() : null
    });
  }
}
