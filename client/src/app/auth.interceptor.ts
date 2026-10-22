import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './services/auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  let request = req;
  if (auth.token) {
    request = req.clone({
      setHeaders: { Authorization: `Bearer ${auth.token}` }
    });
  }

  return next(request).pipe(
    catchError(err => {
      if (err.status === 401 && !req.url.includes('/auth/login') && !req.url.includes('/public')) {
        auth.logout();
        router.navigate(['/login']);
      }
      return throwError(() => err);
    })
  );
};
