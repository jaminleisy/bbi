import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { Computer, Lookups, STATUSES } from '../../models';
import { taxFromInclusiveAmount } from '../../tax';

export interface ComputerDialogData {
  computer: Computer | null;
  lookups: Lookups;
}

@Component({
  selector: 'app-computer-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatCheckboxModule, MatDatepickerModule],
  template: `
    <h2 mat-dialog-title>{{ model.id ? 'Edit Computer' : 'New Computer' }}</h2>
    <mat-dialog-content>
      <div class="form-grid">
        <mat-form-field appearance="outline" style="grid-column: span 2">
          <mat-label>Name</mat-label>
          <input matInput [(ngModel)]="model.name">
          <mat-hint>Leave blank to name from the case and GPU</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Type</mat-label>
          <mat-select [(ngModel)]="model.type">
            <mat-option value="PC">PC</mat-option>
            <mat-option value="Parts">Parts</mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Status</mat-label>
          <mat-select [(ngModel)]="model.status">
            @for (s of statuses; track s) {
              <mat-option [value]="s">{{ s }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <div style="grid-column: span 2; margin: 4px 0 12px">
          <mat-checkbox [(ngModel)]="model.ignoreIncomplete">
            Ignore Incomplete (hide red warning)
          </mat-checkbox>
        </div>

        <mat-form-field appearance="outline" style="grid-column: span 2">
          <mat-label>Description</mat-label>
          <textarea matInput [(ngModel)]="model.description" rows="2"></textarea>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Builder</mat-label>
          <mat-select [(ngModel)]="model.builderUserId">
            <mat-option [value]="null">(none)</mat-option>
            @for (u of data.lookups.users; track u.id) {
              <mat-option [value]="u.id">{{ u.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Location</mat-label>
          <mat-select [(ngModel)]="model.location">
            <mat-option [value]="null">(none)</mat-option>
            @for (l of data.lookups.locations; track l) {
              <mat-option [value]="l">{{ l }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Price (tax-inclusive)</mat-label>
          <input matInput type="number" [(ngModel)]="model.price" (ngModelChange)="onPriceChange($event)">
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Tax (portion of price)</mat-label>
          <input matInput type="number" [(ngModel)]="model.tax" (ngModelChange)="onTaxChange()">
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Original Price</mat-label>
          <input matInput type="number" [(ngModel)]="model.originalPrice">
        </mat-form-field>

        <mat-form-field appearance="outline" style="grid-column:1/-1">
          <mat-label>Bulk description</mat-label>
          <input matInput [(ngModel)]="model.bulkDesc" maxlength="500">
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Bulk cost</mat-label>
          <input matInput type="number" [(ngModel)]="model.bulkCost">
          <span matTextPrefix>$&nbsp;</span>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Expected Completion</mat-label>
          <input matInput [matDatepicker]="ecd" [(ngModel)]="model.expectedCompletionDate">
          <mat-datepicker-toggle matIconSuffix [for]="ecd"></mat-datepicker-toggle>
          <mat-datepicker #ecd></mat-datepicker>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Sold Date</mat-label>
          <input matInput [matDatepicker]="sd" [(ngModel)]="model.soldDate">
          <mat-datepicker-toggle matIconSuffix [for]="sd"></mat-datepicker-toggle>
          <mat-datepicker #sd></mat-datepicker>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Customer Name</mat-label>
          <input matInput [(ngModel)]="model.customerName">
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Customer URL</mat-label>
          <input matInput [(ngModel)]="model.customerUrl">
        </mat-form-field>

        <mat-form-field appearance="outline" style="grid-column: span 2">
          <mat-label>Conversation URL</mat-label>
          <input matInput [(ngModel)]="model.conversationUrl">
        </mat-form-field>

        <mat-form-field appearance="outline" style="grid-column: span 2">
          <mat-label>Customer Info</mat-label>
          <textarea matInput [(ngModel)]="model.customerInfo" rows="2"></textarea>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Address 1</mat-label>
          <input matInput [(ngModel)]="model.customerAddress1">
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Address 2</mat-label>
          <input matInput [(ngModel)]="model.customerAddress2">
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>City</mat-label>
          <input matInput [(ngModel)]="model.customerCity">
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>State</mat-label>
          <input matInput [(ngModel)]="model.customerState">
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Zip</mat-label>
          <input matInput [(ngModel)]="model.customerZip">
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Tracking Number</mat-label>
          <input matInput [(ngModel)]="model.trackingNumber">
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Tracking Status</mat-label>
          <input matInput [(ngModel)]="model.trackingStatus">
        </mat-form-field>

        <mat-form-field appearance="outline" style="grid-column: span 2">
          <mat-label>Notes</mat-label>
          <textarea matInput [(ngModel)]="model.notes" rows="3"></textarea>
        </mat-form-field>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button color="primary" (click)="save()">Save</button>
    </mat-dialog-actions>
  `,
  styles: [`
    :host {
      display: block;
      max-width: 100%;
    }
    .form-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      column-gap: 8px;
      row-gap: 0;
      width: 100%;
      max-width: 480px;
      min-width: 0;
      padding-top: 8px;
      box-sizing: border-box;
    }
    @media (max-width: 480px) {
      .form-grid { grid-template-columns: 1fr; }
    }
    .form-grid mat-form-field {
      width: 100%;
      min-width: 0;
    }
    :host ::ng-deep .mat-mdc-form-field-infix {
      min-width: 0 !important;
      width: auto;
    }
    :host ::ng-deep mat-dialog-content {
      overflow-x: hidden;
      max-width: 100%;
    }
  `]
})
export class ComputerDialogComponent {
  statuses = STATUSES;
  model: Partial<Computer>;
  /** Once the user edits Tax, stop auto-updating it from Price. */
  private taxEdited = false;

  constructor(
    public dialogRef: MatDialogRef<ComputerDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ComputerDialogData
  ) {
    this.model = data.computer
      ? { ...data.computer }
      : {
          name: '',
          type: 'PC',
          status: 'Planned',
          ignoreIncomplete: false
        };
  }

  onPriceChange(price: number | string | null): void {
    if (!this.taxEdited) {
      this.model.tax = taxFromInclusiveAmount(price);
    }
  }

  onTaxChange(): void {
    this.taxEdited = true;
  }

  save(): void {
    this.model.name = this.model.name?.trim() ?? '';
    this.dialogRef.close(this.model);
  }
}
