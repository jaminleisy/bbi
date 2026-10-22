import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDialog, MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Inject } from '@angular/core';
import { AdminUser, ApiService } from '../../services/api.service';

@Component({
  selector: 'app-user-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ data.mode === 'create' ? 'New user' : 'Edit user' }}</h2>
    <mat-dialog-content>
      <div class="form">
        @if (data.mode === 'create') {
          <mat-form-field appearance="outline">
            <mat-label>User ID</mat-label>
            <input matInput [(ngModel)]="userId" required>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Password</mat-label>
            <input matInput type="password" [(ngModel)]="password" required>
          </mat-form-field>
        }
        <mat-form-field appearance="outline">
          <mat-label>Name</mat-label>
          <input matInput [(ngModel)]="name" required>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Permission level</mat-label>
          <mat-select [(ngModel)]="permissionLevel">
            <mat-option [value]="1">1 — Builds only</mat-option>
            <mat-option [value]="2">2 — Computers + Parts (view) + edit computers</mat-option>
            <mat-option [value]="3">3 — Full access + user admin</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Build access</mat-label>
          <input matInput [(ngModel)]="buildAccess">
          <mat-hint>Comma-separated builder names, Unassigned, and/or All</mat-hint>
        </mat-form-field>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button color="primary" [disabled]="!canSave()" (click)="save()">Save</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .form {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
      width: min(360px, calc(100vw - 48px));
      padding-top: 8px;
    }
    mat-form-field { width: 100%; }
  `]
})
export class UserDialogComponent {
  userId = '';
  password = '';
  name = '';
  permissionLevel = 1;
  buildAccess = '';

  constructor(
    public dialogRef: MatDialogRef<UserDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { mode: 'create' | 'edit'; user?: AdminUser }
  ) {
    if (data.user) {
      this.userId = data.user.id;
      this.name = data.user.name;
      this.permissionLevel = data.user.permissionLevel;
      this.buildAccess = data.user.buildAccess ?? '';
    }
  }

  canSave(): boolean {
    if (!this.name.trim()) return false;
    if (this.data.mode === 'create') return !!this.userId.trim() && !!this.password;
    return true;
  }

  save(): void {
    this.dialogRef.close({
      userId: this.userId.trim(),
      password: this.password,
      name: this.name.trim(),
      permissionLevel: this.permissionLevel,
      buildAccess: this.buildAccess.trim() || null
    });
  }
}

@Component({
  selector: 'app-password-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>Set password — {{ data.name }}</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline" style="width:100%;margin-top:8px">
        <mat-label>New password</mat-label>
        <input matInput type="password" [(ngModel)]="password">
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button color="primary" [disabled]="!password" (click)="dialogRef.close(password)">Save</button>
    </mat-dialog-actions>
  `
})
export class PasswordDialogComponent {
  password = '';
  constructor(
    public dialogRef: MatDialogRef<PasswordDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { name: string }
  ) {}
}

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [CommonModule, MatTableModule, MatButtonModule, MatIconModule, MatDialogModule,
    MatSnackBarModule, MatProgressSpinnerModule, MatTooltipModule],
  template: `
    <div class="page-container">
      <div class="header-row">
        <h1>Users</h1>
        <span class="spacer"></span>
        <button mat-flat-button color="primary" (click)="openCreate()">
          <mat-icon>person_add</mat-icon> New user
        </button>
      </div>

      @if (loading) {
        <div class="center"><mat-spinner></mat-spinner></div>
      } @else {
        <div class="table-scroll">
        <table mat-table [dataSource]="users" class="mat-elevation-z1 users-table">
          <ng-container matColumnDef="id">
            <th mat-header-cell *matHeaderCellDef>User ID</th>
            <td mat-cell *matCellDef="let u">{{ u.id }}</td>
          </ng-container>
          <ng-container matColumnDef="name">
            <th mat-header-cell *matHeaderCellDef>Name</th>
            <td mat-cell *matCellDef="let u">{{ u.name }}</td>
          </ng-container>
          <ng-container matColumnDef="permissionLevel">
            <th mat-header-cell *matHeaderCellDef>Permission</th>
            <td mat-cell *matCellDef="let u">{{ levelLabel(u.permissionLevel) }}</td>
          </ng-container>
          <ng-container matColumnDef="buildAccess">
            <th mat-header-cell *matHeaderCellDef>Build access</th>
            <td mat-cell *matCellDef="let u">{{ u.buildAccess || '—' }}</td>
          </ng-container>
          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef></th>
            <td mat-cell *matCellDef="let u">
              <button mat-icon-button matTooltip="Edit" (click)="openEdit(u)">
                <mat-icon>edit</mat-icon>
              </button>
              <button mat-icon-button matTooltip="Set password" (click)="openPassword(u)">
                <mat-icon>password</mat-icon>
              </button>
            </td>
          </ng-container>
          <tr mat-header-row *matHeaderRowDef="columns"></tr>
          <tr mat-row *matRowDef="let row; columns: columns;"></tr>
        </table>
        </div>
      }
    </div>
  `,
  styles: [`
    .header-row { display: flex; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 8px; }
    .center { display: flex; justify-content: center; padding: 48px; }
    .users-table { width: 100%; min-width: 560px; background: #fff; }
  `]
})
export class UsersComponent implements OnInit {
  columns = ['id', 'name', 'permissionLevel', 'buildAccess', 'actions'];
  users: AdminUser[] = [];
  loading = true;

  constructor(private api: ApiService, private dialog: MatDialog, private snack: MatSnackBar) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.api.getUsers().subscribe({
      next: users => { this.users = users; this.loading = false; },
      error: () => this.loading = false
    });
  }

  levelLabel(level: number): string {
    switch (level) {
      case 1: return '1 — Builds';
      case 2: return '2 — Computers / Parts';
      case 3: return '3 — Full admin';
      default: return String(level);
    }
  }

  openCreate(): void {
    const ref = this.dialog.open(UserDialogComponent, { data: { mode: 'create' } });
    ref.afterClosed().subscribe(result => {
      if (!result) return;
      this.api.createUser(result).subscribe({
        next: () => { this.snack.open('User created', undefined, { duration: 2000 }); this.load(); },
        error: err => this.snack.open(err.error?.message ?? 'Create failed', 'OK')
      });
    });
  }

  openEdit(user: AdminUser): void {
    const ref = this.dialog.open(UserDialogComponent, { data: { mode: 'edit', user } });
    ref.afterClosed().subscribe(result => {
      if (!result) return;
      this.api.updateUser(user.id, {
        name: result.name,
        permissionLevel: result.permissionLevel,
        buildAccess: result.buildAccess
      }).subscribe({
        next: () => { this.snack.open('User updated', undefined, { duration: 2000 }); this.load(); },
        error: err => this.snack.open(err.error?.message ?? 'Update failed', 'OK')
      });
    });
  }

  openPassword(user: AdminUser): void {
    const ref = this.dialog.open(PasswordDialogComponent, { data: { name: user.name }, width: '320px' });
    ref.afterClosed().subscribe((password: string | undefined) => {
      if (!password) return;
      this.api.setUserPassword(user.id, password).subscribe({
        next: () => this.snack.open('Password updated', undefined, { duration: 2000 }),
        error: err => this.snack.open(err.error?.message ?? 'Password update failed', 'OK')
      });
    });
  }
}
