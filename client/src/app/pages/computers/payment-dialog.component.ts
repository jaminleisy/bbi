import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { Computer, Payment, PAYMENT_METHODS, PAYMENT_TYPES } from '../../models';
import { taxFromInclusiveAmount } from '../../tax';

/** Dialog close payload: payment fields plus optional computer customer fields. */
export type PaymentDialogResult = Partial<Payment> & {
  customerName?: string | null;
  customerUrl?: string | null;
  conversationUrl?: string | null;
};

@Component({
  selector: 'app-payment-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatDatepickerModule],
  template: `
    <h2 mat-dialog-title>Record Payment — {{ data.computer.name }}</h2>
    <mat-dialog-content>
      <div class="pay-form">
        <mat-form-field appearance="outline">
          <mat-label>Type</mat-label>
          <mat-select [(ngModel)]="model.type">
            @for (t of types; track t) {
              <mat-option [value]="t">{{ t }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Amount (tax-inclusive)</mat-label>
          <input matInput type="number" [(ngModel)]="model.amount" (ngModelChange)="onAmountChange($event)" required>
          <span matTextPrefix>$&nbsp;</span>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Tax</mat-label>
          <input matInput type="number" [(ngModel)]="model.tax" (ngModelChange)="onTaxChange()">
          <span matTextPrefix>$&nbsp;</span>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Fee</mat-label>
          <input matInput type="number" [(ngModel)]="model.fee">
          <span matTextPrefix>$&nbsp;</span>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Method</mat-label>
          <mat-select [(ngModel)]="model.method">
            @for (m of methods; track m) {
              <mat-option [value]="m">{{ m }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Date</mat-label>
          <input matInput [matDatepicker]="picker" [(ngModel)]="model.date">
          <mat-datepicker-toggle matIconSuffix [for]="picker"></mat-datepicker-toggle>
          <mat-datepicker #picker></mat-datepicker>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Payment URL</mat-label>
          <input matInput [(ngModel)]="model.paymentUrl">
        </mat-form-field>

        @if (needsCustomerInfo) {
          <mat-form-field appearance="outline">
            <mat-label>Customer Name</mat-label>
            <input matInput [(ngModel)]="customerName">
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Customer URL</mat-label>
            <input matInput [(ngModel)]="customerUrl">
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Conversation URL</mat-label>
            <input matInput [(ngModel)]="conversationUrl">
          </mat-form-field>
        }

        @if (remaining !== null) {
          <div style="margin-bottom:8px">
            Remaining balance after this payment:
            <strong [class.ok-text]="afterBalance <= 0" [class.warn-text]="afterBalance > 0">
              {{ afterBalance | currency }}
            </strong>
            @if (afterBalance <= 0) {
              <div class="ok-text">This will mark the computer as <strong>Sold</strong>.</div>
            }
          </div>
        }
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button color="primary" [disabled]="!model.amount" (click)="save()">Record</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .pay-form {
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
export class PaymentDialogComponent {
  types = PAYMENT_TYPES;
  methods = PAYMENT_METHODS;
  model: Partial<Payment> = { type: 'payment', date: new Date().toISOString() };
  remaining: number | null = null;
  /** Once the user edits Tax, stop auto-updating it from Amount. */
  private taxEdited = false;

  /** Shown only when the computer has no customer info yet. */
  needsCustomerInfo = false;
  customerName = '';
  customerUrl = '';
  conversationUrl = '';

  constructor(
    public dialogRef: MatDialogRef<PaymentDialogComponent, PaymentDialogResult | undefined>,
    @Inject(MAT_DIALOG_DATA) public data: { computer: Computer }
  ) {
    // Price is tax-inclusive; Payment.Amount is the full customer payment.
    const total = data.computer.price ?? 0;
    if (total > 0) {
      this.remaining = total - (data.computer.netPaid ?? 0);
    }
    const c = data.computer;
    this.needsCustomerInfo = !c.customerName?.trim()
      && !c.customerUrl?.trim()
      && !c.conversationUrl?.trim();
  }

  get afterBalance(): number {
    const amt = this.model.amount ?? 0;
    const sign = this.model.type === 'refund' ? -1 : 1;
    return (this.remaining ?? 0) - sign * amt;
  }

  onAmountChange(amount: number | string | null): void {
    if (!this.taxEdited) {
      this.model.tax = taxFromInclusiveAmount(amount);
    }
  }

  onTaxChange(): void {
    this.taxEdited = true;
  }

  save(): void {
    const result: PaymentDialogResult = { ...this.model };
    if (this.needsCustomerInfo) {
      result.customerName = this.customerName.trim() || null;
      result.customerUrl = this.customerUrl.trim() || null;
      result.conversationUrl = this.conversationUrl.trim() || null;
    }
    this.dialogRef.close(result);
  }
}
