import { Injectable, signal } from '@angular/core';

const THEME_KEY = 'bbi-theme';
const DARK_CLASS = 'dark-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly isDark = signal(readSavedIsDark());

  constructor() {
    this.apply(this.isDark());
  }

  toggle(): void {
    this.setDark(!this.isDark());
  }

  setDark(dark: boolean): void {
    this.isDark.set(dark);
    this.apply(dark);
    try {
      localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
    } catch {
      // Ignore quota / private-mode failures; the session still has the class.
    }
  }

  private apply(dark: boolean): void {
    document.documentElement.classList.toggle(DARK_CLASS, dark);
  }
}

export function readSavedIsDark(): boolean {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark';
  } catch {
    return false;
  }
}
