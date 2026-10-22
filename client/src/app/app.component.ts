import { Component, OnInit } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatBadgeModule } from '@angular/material/badge';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { AuthService } from './services/auth.service';
import { MessengerNotificationsService } from './services/messenger-notifications.service';
import { ChangePasswordDialogComponent } from './change-password-dialog.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet, RouterLink, RouterLinkActive, MatToolbarModule, MatButtonModule,
    MatIconModule, MatMenuModule, MatBadgeModule, MatDialogModule
  ],
  template: `
    @if (auth.isLoggedIn) {
      <mat-toolbar color="primary" class="app-toolbar">
        <button mat-icon-button class="nav-menu-btn" [matMenuTriggerFor]="navMenu" aria-label="Open navigation">
          <mat-icon>menu</mat-icon>
        </button>
        <mat-icon class="brand-icon">memory</mat-icon>
        <span class="brand-text">BenBot Inventory</span>

        <nav class="desktop-nav">
          @if (auth.canAccessComputers()) {
            <a mat-button routerLink="/computers" routerLinkActive="active-link">
              <mat-icon>computer</mat-icon>
              <span class="nav-label">In-Progress</span>
            </a>
            <a mat-button routerLink="/sold-computers" routerLinkActive="active-link">
              <mat-icon>sell</mat-icon>
              <span class="nav-label">Sold</span>
            </a>
          }
          @if (auth.canAccessParts()) {
            <a mat-button routerLink="/parts" routerLinkActive="active-link">
              <mat-icon>widgets</mat-icon>
              <span class="nav-label">Parts</span>
            </a>
            <a mat-button routerLink="/parts-check-off" routerLinkActive="active-link">
              <mat-icon>checklist</mat-icon>
              <span class="nav-label">Check Off</span>
            </a>
          }
          @if (auth.canAccessComputers()) {
            <a mat-button routerLink="/messages" routerLinkActive="active-link">
              <mat-icon
                [matBadge]="messenger.unreadCount()"
                [matBadgeHidden]="messenger.unreadCount() === 0"
                matBadgeColor="warn"
                matBadgeSize="small">chat</mat-icon>
              <span class="nav-label">Messages</span>
            </a>
          }
          <a mat-button routerLink="/builds" routerLinkActive="active-link">
            <mat-icon>handyman</mat-icon>
            <span class="nav-label">Builds</span>
          </a>
          @if (auth.canAccessSummary()) {
            <a mat-button routerLink="/summary" routerLinkActive="active-link">
              <mat-icon>assessment</mat-icon>
              <span class="nav-label">Summary</span>
            </a>
          }
          @if (auth.canManageUsers()) {
            <a mat-button routerLink="/users" routerLinkActive="active-link">
              <mat-icon>group</mat-icon>
              <span class="nav-label">Users</span>
            </a>
          }
        </nav>

        <span class="spacer"></span>

        <button mat-button class="user-btn" [matMenuTriggerFor]="userMenu">
          <mat-icon>account_circle</mat-icon>
          <span class="user-name">{{ auth.currentUser()?.name }}</span>
        </button>
        <mat-menu #userMenu="matMenu" panelClass="user-account-menu">
          <div class="user-menu-name" role="menuitem" aria-disabled="true">
            {{ auth.currentUser()?.name }}
          </div>
          <button mat-menu-item (click)="openChangePassword()">
            <mat-icon>lock</mat-icon> Change Password
          </button>
          <button mat-menu-item (click)="auth.logout()">
            <mat-icon>logout</mat-icon> Log out
          </button>
        </mat-menu>

        <mat-menu #navMenu="matMenu" class="mobile-nav-menu">
          @if (auth.canAccessComputers()) {
            <a mat-menu-item routerLink="/computers" routerLinkActive="active-menu">
              <mat-icon>computer</mat-icon>
              <span>In-Progress Computers</span>
            </a>
            <a mat-menu-item routerLink="/sold-computers" routerLinkActive="active-menu">
              <mat-icon>sell</mat-icon>
              <span>Sold Computers</span>
            </a>
          }
          @if (auth.canAccessParts()) {
            <a mat-menu-item routerLink="/parts" routerLinkActive="active-menu">
              <mat-icon>widgets</mat-icon>
              <span>Parts</span>
            </a>
            <a mat-menu-item routerLink="/parts-check-off" routerLinkActive="active-menu">
              <mat-icon>checklist</mat-icon>
              <span>Parts Check Off</span>
            </a>
          }
          @if (auth.canAccessComputers()) {
            <a mat-menu-item routerLink="/messages" routerLinkActive="active-menu">
              <mat-icon
                [matBadge]="messenger.unreadCount()"
                [matBadgeHidden]="messenger.unreadCount() === 0"
                matBadgeColor="warn"
                matBadgeSize="small">chat</mat-icon>
              <span>Messages</span>
            </a>
          }
          <a mat-menu-item routerLink="/builds" routerLinkActive="active-menu">
            <mat-icon>handyman</mat-icon>
            <span>Builds</span>
          </a>
          @if (auth.canAccessSummary()) {
            <a mat-menu-item routerLink="/summary" routerLinkActive="active-menu">
              <mat-icon>assessment</mat-icon>
              <span>Summary</span>
            </a>
          }
          @if (auth.canManageUsers()) {
            <a mat-menu-item routerLink="/users" routerLinkActive="active-menu">
              <mat-icon>group</mat-icon>
              <span>Users</span>
            </a>
          }
        </mat-menu>
      </mat-toolbar>
    }
    <router-outlet></router-outlet>
  `,
  styles: [`
    .app-toolbar {
      position: sticky;
      top: 0;
      z-index: 100;
      gap: 4px;
      min-height: 56px;
      height: auto;
      flex-wrap: nowrap;
      padding: 0 8px;
    }
    .brand-icon { margin-right: 4px; flex-shrink: 0; }
    .brand-text {
      font-weight: 500;
      margin-right: 8px;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .desktop-nav {
      display: none;
      align-items: center;
      flex-wrap: wrap;
      gap: 0;
      min-width: 0;
    }
    .desktop-nav a {
      min-width: 0;
    }
    .nav-menu-btn { display: inline-flex; }
    .user-btn {
      min-width: 0;
      padding: 0 8px;
      flex-shrink: 0;
    }
    .user-name {
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .active-link { background: rgba(255,255,255,0.15); }

    @media (min-width: 900px) {
      .nav-menu-btn { display: none; }
      .desktop-nav { display: flex; }
      .app-toolbar { padding: 0 16px; }
    }

    @media (max-width: 599px) {
      .brand-text { font-size: 15px; }
      .user-name { display: none; }
    }
  `]
})
export class AppComponent implements OnInit {
  constructor(
    public auth: AuthService,
    public messenger: MessengerNotificationsService,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    if (this.auth.isLoggedIn) {
      this.auth.refreshMe().subscribe({
        next: () => this.messenger.maybeStart(),
        error: () => this.auth.logout()
      });
    }
  }

  openChangePassword(): void {
    this.dialog.open(ChangePasswordDialogComponent, { width: '380px' });
  }
}
