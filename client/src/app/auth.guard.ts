import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './services/auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isLoggedIn) return true;
  router.navigate(['/login']);
  return false;
};

/** Requires PermissionLevel >= minLevel (default 1). */
export function permissionGuard(minLevel: number): CanActivateFn {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    if (!auth.isLoggedIn) {
      router.navigate(['/login']);
      return false;
    }
    if (auth.permissionLevel() >= minLevel) return true;
    router.navigate([auth.homeRoute()]);
    return false;
  };
}
