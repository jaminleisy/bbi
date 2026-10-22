import { Routes } from '@angular/router';
import { authGuard, permissionGuard } from './auth.guard';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login/login.component').then(m => m.LoginComponent) },
  {
    path: 'computers',
    loadComponent: () => import('./pages/computers/computers.component').then(m => m.ComputersComponent),
    canActivate: [permissionGuard(2)],
    data: { mode: 'in-progress' }
  },
  {
    path: 'sold-computers',
    loadComponent: () => import('./pages/computers/computers.component').then(m => m.ComputersComponent),
    canActivate: [permissionGuard(2)],
    data: { mode: 'sold' }
  },
  {
    path: 'sold-computers/:id/invoice',
    loadComponent: () => import('./pages/computers/invoice-page.component').then(m => m.InvoicePageComponent),
    canActivate: [permissionGuard(2)]
  },
  { path: 'parts', loadComponent: () => import('./pages/parts/parts.component').then(m => m.PartsComponent), canActivate: [permissionGuard(2)] },
  {
    path: 'parts/import-pdfs',
    loadComponent: () => import('./pages/parts/import-order-pdfs.component').then(m => m.ImportOrderPdfsComponent),
    canActivate: [permissionGuard(3)]
  },
  {
    path: 'parts-check-off',
    loadComponent: () => import('./pages/parts-check-off/parts-check-off.component').then(m => m.PartsCheckOffComponent),
    canActivate: [permissionGuard(2)]
  },
  {
    path: 'messages',
    loadComponent: () => import('./pages/messages/messages.component').then(m => m.MessagesComponent),
    canActivate: [permissionGuard(2)]
  },
  {
    path: 'messages/rules',
    loadComponent: () => import('./pages/messages/rules.component').then(m => m.MessengerRulesComponent),
    canActivate: [permissionGuard(3)]
  },
  { path: 'builds', loadComponent: () => import('./pages/builds/builds.component').then(m => m.BuildsComponent), canActivate: [authGuard] },
  { path: 'builds/:id', loadComponent: () => import('./pages/builds/build-detail.component').then(m => m.BuildDetailComponent), canActivate: [authGuard] },
  { path: 'summary', loadComponent: () => import('./pages/summary/summary.component').then(m => m.SummaryComponent), canActivate: [permissionGuard(3)] },
  { path: 'users', loadComponent: () => import('./pages/users/users.component').then(m => m.UsersComponent), canActivate: [permissionGuard(3)] },
  { path: 'build/:id', loadComponent: () => import('./pages/public-build/public-build.component').then(m => m.PublicBuildComponent) },
  { path: '', pathMatch: 'full', redirectTo: 'builds' },
  { path: '**', redirectTo: 'builds' }
];
