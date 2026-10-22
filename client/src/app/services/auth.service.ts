import { Injectable, computed, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface AuthUser {
  userId: string;
  name: string;
  permissionLevel: number;
}

interface LoginResponse {
  token: string;
  userId: string;
  name: string;
  permissionLevel: number;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly TOKEN_KEY = 'bbi_token';
  private readonly USER_KEY = 'bbi_user';

  currentUser = signal<AuthUser | null>(this.loadUser());
  permissionLevel = computed(() => this.currentUser()?.permissionLevel ?? 0);
  canAccessComputers = computed(() => this.permissionLevel() >= 2);
  canAccessParts = computed(() => this.permissionLevel() >= 2);
  /** Level 2+: edit build parts, status, and builder on the Builds pages. */
  canEditBuilds = computed(() => this.permissionLevel() >= 2);
  canEditParts = computed(() => this.permissionLevel() >= 3);
  canAccessSummary = computed(() => this.permissionLevel() >= 3);
  canManageUsers = computed(() => this.permissionLevel() >= 3);

  constructor(private http: HttpClient, private router: Router) {}

  private loadUser(): AuthUser | null {
    const raw = localStorage.getItem(this.USER_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return {
        userId: parsed.userId,
        name: parsed.name,
        permissionLevel: Number(parsed.permissionLevel) || 1
      };
    } catch {
      return null;
    }
  }

  get token(): string | null {
    return localStorage.getItem(this.TOKEN_KEY);
  }

  get isLoggedIn(): boolean {
    return !!this.token;
  }

  homeRoute(): string {
    return this.permissionLevel() >= 2 ? '/computers' : '/builds';
  }

  login(userId: string, password: string) {
    return this.http.post<LoginResponse>(`${environment.apiUrl}/auth/login`, { userId, password }).pipe(
      tap(res => this.persistSession(res.token, {
        userId: res.userId,
        name: res.name,
        permissionLevel: res.permissionLevel
      }))
    );
  }

  refreshMe() {
    return this.http.get<{ userId: string; name: string; permissionLevel: number }>(`${environment.apiUrl}/auth/me`).pipe(
      tap(res => {
        if (!this.token) return;
        this.persistSession(this.token, {
          userId: res.userId,
          name: res.name,
          permissionLevel: res.permissionLevel
        });
      })
    );
  }

  changePassword(newPassword: string) {
    return this.http.post(`${environment.apiUrl}/auth/change-password`, { newPassword });
  }

  logout(): void {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
    this.currentUser.set(null);
    this.router.navigate(['/login']);
  }

  private persistSession(token: string, user: AuthUser): void {
    localStorage.setItem(this.TOKEN_KEY, token);
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
    this.currentUser.set(user);
  }
}
