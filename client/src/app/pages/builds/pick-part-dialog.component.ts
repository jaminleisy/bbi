import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ApiService } from '../../services/api.service';
import { BuildUnassignedPart } from '../../models';
import { isUsedUntested, openPartOrderUrl, partDisplayLabel } from '../../part-display';

@Component({
  selector: 'app-pick-part-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule, MatSnackBarModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      <p class="hint">Unassigned <strong>{{ data.type }}</strong> parts</p>
      <mat-form-field appearance="outline" style="width:100%">
        <mat-label>Filter</mat-label>
        <input matInput [(ngModel)]="filter">
        @if (filter) {
          <button matSuffix mat-icon-button type="button" (click)="filter = ''" aria-label="Clear search">
            <mat-icon>close</mat-icon>
          </button>
        }
      </mat-form-field>
      @if (loading) {
        <div class="center"><mat-spinner diameter="32"></mat-spinner></div>
      } @else if (!filtered.length) {
        <div class="empty">No unassigned {{ data.type }} parts available.</div>
      } @else {
        <div class="list">
          @for (p of filtered; track p.id) {
            <button mat-button class="part-btn" type="button" (click)="onPartClick($event, p)">
              <span class="part-main">
                {{ partDisplayLabel(p) }}
                @if (isUsedUntested(p)) {
                  <mat-icon class="needs-test-icon" matTooltip="Used — needs testing">pending_actions</mat-icon>
                }
              </span>
              @if (p.location) {
                <span class="part-location">{{ p.location }}</span>
              }
              @if (!p.received) { <span class="warn">[not received]</span> }
            </button>
          }
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .hint { margin: 0 0 8px; color: #666; font-size: 13px; }
    .center { display: flex; justify-content: center; padding: 24px; }
    .empty { color: #999; padding: 12px 0; }
    .list { max-height: 360px; overflow-y: auto; display: flex; flex-direction: column; }
    .part-btn {
      justify-content: flex-start;
      text-align: left;
      height: auto;
      padding: 8px 12px;
      border-bottom: 1px solid #f0f0f0;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 8px;
    }
    .part-main {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
    }
    .part-location {
      font-size: 11px;
      background: #e3f2fd;
      color: #1565c0;
      border-radius: 8px;
      padding: 1px 7px;
    }
    .needs-test-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      vertical-align: middle;
      color: #ef6c00;
      flex-shrink: 0;
    }
    .warn { color: #d32f2f; font-size: 12px; }
  `]
})
export class PickPartDialogComponent implements OnInit {
  partDisplayLabel = partDisplayLabel;
  isUsedUntested = isUsedUntested;
  parts: BuildUnassignedPart[] = [];
  filter = '';
  loading = true;

  constructor(
    public dialogRef: MatDialogRef<PickPartDialogComponent, BuildUnassignedPart>,
    @Inject(MAT_DIALOG_DATA) public data: { type: string; title: string },
    private api: ApiService,
    private snack: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.api.getBuildUnassignedParts(this.data.type).subscribe({
      next: parts => { this.parts = parts; this.loading = false; },
      error: () => { this.loading = false; }
    });
  }

  get filtered(): BuildUnassignedPart[] {
    const f = this.filter.toLowerCase().trim();
    if (!f) return this.parts;
    return this.parts.filter(p =>
      (p.manufacturer ?? '').toLowerCase().includes(f) ||
      (p.modelNumber ?? '').toLowerCase().includes(f) ||
      (p.color ?? '').toLowerCase().includes(f) ||
      (p.location ?? '').toLowerCase().includes(f));
  }

  onPartClick(event: MouseEvent, p: BuildUnassignedPart): void {
    if (event.ctrlKey) {
      event.preventDefault();
      event.stopPropagation();
      if (!openPartOrderUrl(p)) {
        this.snack.open('No URL', undefined, { duration: 2000 });
      }
      return;
    }
    this.dialogRef.close(p);
  }
}
