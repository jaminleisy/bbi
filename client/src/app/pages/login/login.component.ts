import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../services/auth.service';
import { MessengerNotificationsService } from '../../services/messenger-notifications.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="login-wrapper">
      <mat-card class="login-card">
        <mat-card-header>
          <mat-card-title>
            <mat-icon style="vertical-align:middle;margin-right:8px">memory</mat-icon>
            BenBot Inventory
          </mat-card-title>
          <mat-card-subtitle>Sign in to manage your inventory</mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
          <form (ngSubmit)="login()" style="display:flex;flex-direction:column;gap:8px;margin-top:16px">
            <mat-form-field appearance="outline">
              <mat-label>User ID</mat-label>
              <input matInput name="userId" [(ngModel)]="userId" required autocomplete="username">
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Password</mat-label>
              <input matInput name="password" type="password" [(ngModel)]="password" required autocomplete="current-password">
            </mat-form-field>
            @if (error) {
              <div class="warn-text">{{ error }}</div>
            }
            <button mat-flat-button color="primary" type="submit" [disabled]="loading">
              @if (loading) { <mat-spinner diameter="20" style="display:inline-block"></mat-spinner> }
              @else { Sign In }
            </button>
          </form>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [`
    .login-wrapper {
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; padding: 16px; box-sizing: border-box;
      background: linear-gradient(135deg, #1a237e, #0d47a1);
    }
    .login-card { width: 100%; max-width: 380px; padding: 16px; }
  `]
})
export class LoginComponent {
  userId = '';
  password = '';
  error = '';
  loading = false;

  constructor(
    private auth: AuthService,
    private router: Router,
    private messenger: MessengerNotificationsService
  ) {}

  login(): void {
    this.error = '';
    this.loading = true;
    this.auth.login(this.userId, this.password).subscribe({
      next: () => {
        this.messenger.maybeStart();
        this.router.navigate([this.auth.homeRoute()]);
      },
      error: err => {
        this.loading = false;
        this.error = err.error?.message ?? 'Login failed. Please try again.';
      }
    });
  }
}
