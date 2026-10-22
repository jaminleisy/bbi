import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { Computer, ComputerShare, Lookups } from '../../models';

export interface ShareDialogData {
  computer: Computer;
  lookups: Lookups;
  share?: ComputerShare | null;
}

@Component({
  selector: 'app-share-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ editing ? 'Edit Share' : 'Add Share' }} — {{ data.computer.name }}</h2>
    <mat-dialog-content>
      <div class="share-form">
        <mat-form-field appearance="outline">
          <mat-label>Builder</mat-label>
          <mat-select [(ngModel)]="model.builderUserId" required>
            @for (u of data.lookups.users; track u.id) {
              <mat-option [value]="u.id">{{ u.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Percentage</mat-label>
          <input matInput type="number" [(ngModel)]="model.percentage" required
                 min="0.01" max="100" step="0.01">
          <span matTextSuffix>%&nbsp;</span>
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
    .share-form {
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
export class ShareDialogComponent {
  editing: boolean;
  model: Partial<ComputerShare>;

  constructor(
    public dialogRef: MatDialogRef<ShareDialogComponent, Partial<ComputerShare> | undefined>,
    @Inject(MAT_DIALOG_DATA) public data: ShareDialogData
  ) {
    this.editing = !!data.share;
    const s = data.share;
    this.model = {
      id: s?.id,
      computerId: data.computer.id,
      builderUserId: s?.builderUserId ?? this.defaultBuilderUserId(),
      percentage: s?.percentage
    };
  }

  private defaultBuilderUserId(): string {
    const josh = this.data.lookups.users.find(u =>
      u.id === 'Josh B' || u.name === 'Josh B' || u.name.startsWith('Josh B'));
    return josh?.id ?? '';
  }

  get canSave(): boolean {
    if (!this.model.builderUserId) return false;
    const pct = Number(this.model.percentage);
    return !Number.isNaN(pct) && pct > 0 && pct <= 100;
  }

  save(): void {
    if (!this.canSave) return;
    this.dialogRef.close({
      ...this.model,
      percentage: Number(this.model.percentage),
      computerId: this.data.computer.id
    });
  }
}
