import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';

export interface PriceEditDialogData {
  name: string;
  price?: number | null;
}

@Component({
  selector: 'app-price-edit-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>Edit price</h2>
    <mat-dialog-content>
      <p class="hint">{{ data.name }}</p>
      <mat-form-field appearance="outline" style="width:100%">
        <mat-label>Price (tax-inclusive)</mat-label>
        <input matInput type="number" [(ngModel)]="price" (keyup.enter)="save()" autofocus>
        <mat-hint>Total customer pays, including tax</mat-hint>
        <span matTextPrefix>$&nbsp;</span>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-button (click)="clear()">Clear</button>
      <button mat-flat-button color="primary" (click)="save()">Save</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .hint { margin: 0 0 8px; color: #666; font-size: 13px; }
  `]
})
export class PriceEditDialogComponent {
  price: number | null;

  constructor(
    public dialogRef: MatDialogRef<PriceEditDialogComponent, number | null>,
    @Inject(MAT_DIALOG_DATA) public data: PriceEditDialogData
  ) {
    this.price = data.price ?? null;
  }

  clear(): void {
    this.dialogRef.close(null);
  }

  save(): void {
    const value = this.price;
    if (value === null || value === undefined || (typeof value === 'number' && Number.isNaN(value))) {
      this.dialogRef.close(null);
      return;
    }
    this.dialogRef.close(Number(value));
  }
}
