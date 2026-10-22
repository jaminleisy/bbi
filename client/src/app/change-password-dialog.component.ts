import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-change-password-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatSnackBarModule
  ],
  template: `
    <h2 mat-dialog-title>Change Password</h2>
    <mat-dialog-content>
      <div class="form">
        <mat-form-field appearance="outline">
          <mat-label>New Password</mat-label>
          <input matInput type="password" [(ngModel)]="newPassword" autocomplete="new-password" required>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Confirm password</mat-label>
          <input matInput type="password" [(ngModel)]="confirmPassword" autocomplete="new-password"
                 (keyup.enter)="submit()" required>
        </mat-form-field>
        @if (mismatch) {
          <p class="error">Passwords do not match.</p>
        }
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close [disabled]="busy">Cancel</button>
      <button mat-flat-button color="primary" type="button" [disabled]="!canSubmit || busy" (click)="submit()">
        Change Password
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .form {
      display: flex;
      flex-direction: column;
      min-width: 0;
      width: 100%;
      max-width: 360px;
      padding-top: 8px;
      box-sizing: border-box;
    }
    .form mat-form-field { width: 100%; }
    .error { margin: 0 0 4px; color: #c62828; font-size: 13px; }
  `]
})
export class ChangePasswordDialogComponent {
  newPassword = '';
  confirmPassword = '';
  busy = false;

  constructor(
    public dialogRef: MatDialogRef<ChangePasswordDialogComponent, boolean | undefined>,
    private auth: AuthService,
    private snack: MatSnackBar
  ) {}

  get mismatch(): boolean {
    return !!this.confirmPassword && this.newPassword !== this.confirmPassword;
  }

  get canSubmit(): boolean {
    return !!this.newPassword && this.newPassword === this.confirmPassword;
  }

  submit(): void {
    if (!this.canSubmit || this.busy) return;
    this.busy = true;
    this.auth.changePassword(this.newPassword).subscribe({
      next: () => {
        this.snack.open('Password changed', undefined, { duration: 2000 });
        this.dialogRef.close(true);
      },
      error: err => {
        this.busy = false;
        this.snack.open(err.error?.message ?? 'Failed to change password', 'OK');
      }
    });
  }
}
