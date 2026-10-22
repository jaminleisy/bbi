import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ApiService } from '../../services/api.service';
import { Computer, Lookups, Part, PartPlaceholder } from '../../models';
import { computerDisplayName, confirmReassignFromPlanned, isScamPart, isUsedUntested, openPartOrderUrl, partDisplayLabel, sortByPartType, sortTypeNames } from '../../part-display';

@Component({
  selector: 'app-assign-parts-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatCheckboxModule, MatIconModule, MatChipsModule, MatSelectModule,
    MatSnackBarModule, MatTooltipModule],
  template: `
    <h2 mat-dialog-title>Edit Parts — {{ computerDisplayName(data.computer) }}</h2>
    <mat-dialog-content>
      @if (data.computer.type === 'PC') {
        <div style="margin-bottom:12px">
          @for (t of requiredTypes; track t) {
            <mat-chip [class.chip-ok]="hasType(t)" [class.chip-missing]="!hasType(t)" style="margin:2px">
              <mat-icon style="font-size:16px;height:16px;width:16px">
                {{ hasType(t) ? 'check' : 'close' }}
              </mat-icon>
              {{ t }}
            </mat-chip>
          }
        </div>
      }

      <h3 class="section-title">Planned (not purchased)</h3>
      <p class="hint">Custom text for parts you intend to use but do not have in inventory yet.</p>
      <div class="add-planned">
        <mat-form-field appearance="outline">
          <mat-label>Type</mat-label>
          <mat-select [(ngModel)]="newType">
            @for (t of allTypes; track t) {
              <mat-option [value]="t">{{ t }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" class="desc-field">
          <mat-label>Description</mat-label>
          <input matInput [(ngModel)]="newDescription" maxlength="200"
                 (keyup.enter)="addPlaceholder()">
        </mat-form-field>
        <button mat-stroked-button color="primary"
                [disabled]="!newType || !newDescription.trim() || savingPh"
                (click)="addPlaceholder()">
          Add
        </button>
      </div>
      @if (placeholders.length) {
        <ul class="ph-list">
          @for (ph of placeholders; track ph.id) {
            <li>
              <strong>{{ ph.type }}</strong>
              <span class="planned-badge">Planned</span>
              — {{ ph.description }}
              <button mat-icon-button aria-label="Remove" (click)="removePlaceholder(ph)" [disabled]="savingPh">
                <mat-icon>close</mat-icon>
              </button>
            </li>
          }
        </ul>
      } @else {
        <div class="empty-ph">No planned parts yet.</div>
      }

      <h3 class="section-title">Inventory parts</h3>
      <mat-form-field appearance="outline" style="width:100%">
        <mat-label>Filter available parts</mat-label>
        <input matInput [(ngModel)]="filter">
        @if (filter) {
          <button matSuffix mat-icon-button type="button" (click)="filter = ''" aria-label="Clear search">
            <mat-icon>close</mat-icon>
          </button>
        } @else {
          <mat-icon matIconSuffix>search</mat-icon>
        }
      </mat-form-field>
      <mat-checkbox class="show-planned" [(ngModel)]="showPlanned">
        Show parts assigned to planned PCs
      </mat-checkbox>

      <div class="parts-list">
        @for (part of filteredParts; track part.id) {
          <div class="part-row">
            <mat-checkbox [checked]="selectedIds.has(part.id)"
                          (click)="onInventoryPartClick($event, part)">
              <strong>{{ part.type }}</strong> —
              {{ partDisplayLabel(part) }}
              @if (part.cost != null) { ({{ part.cost | currency }}) }
              @if (part.location) {
                <span class="part-location">{{ part.location }}</span>
              }
              @if (isUsedUntested(part)) {
                <mat-icon class="needs-test-icon" matTooltip="Used — needs testing">pending_actions</mat-icon>
              }
              @if (!part.received) { <span class="warn-text">[not received]</span> }
              @if (isOnOtherComputer(part)) {
                <span class="planned-on">On planned: {{ part.computerName }}</span>
              }
            </mat-checkbox>
          </div>
        }
        @if (filteredParts.length === 0) {
          <div style="padding:12px;color:#777">No unassigned parts match.</div>
        }
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button color="primary" (click)="save()">Save Parts</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .section-title { margin: 16px 0 4px; font-size: 15px; font-weight: 500; }
    .hint { margin: 0 0 8px; color: #666; font-size: 13px; }
    .add-planned {
      display: flex; gap: 8px; align-items: flex-start; flex-wrap: wrap; margin-bottom: 8px;
    }
    .desc-field { flex: 1; min-width: 200px; }
    .ph-list {
      list-style: none; margin: 0 0 8px; padding: 0;
      border: 1px solid #e0e0e0; border-radius: 4px;
    }
    .ph-list li {
      display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
      padding: 4px 8px 4px 12px; border-bottom: 1px solid #f0f0f0; font-size: 13px;
    }
    .ph-list li:last-child { border-bottom: none; }
    .ph-list button { margin-left: auto; }
    .planned-badge {
      font-size: 11px; background: #fff3e0; color: #e65100;
      border-radius: 8px; padding: 1px 6px;
    }
    .empty-ph { color: #999; font-size: 13px; margin-bottom: 8px; }
    .parts-list {
      max-height: 280px;
      overflow-y: auto;
      min-width: 0;
      width: 100%;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
    }
    :host ::ng-deep mat-dialog-content {
      max-width: min(560px, calc(100vw - 32px));
    }
    .part-row { padding: 4px 12px; border-bottom: 1px solid #f0f0f0; }
    .part-location {
      display: inline-block;
      margin-left: 6px;
      font-size: 11px;
      background: #e3f2fd;
      color: #1565c0;
      border-radius: 8px;
      padding: 1px 7px;
      vertical-align: middle;
    }
    .planned-on {
      display: inline-block;
      margin-left: 6px;
      font-size: 11px;
      background: #fff3e0;
      color: #e65100;
      border-radius: 8px;
      padding: 1px 7px;
      vertical-align: middle;
    }
    .show-planned { display: block; margin: -8px 0 8px; }
    .needs-test-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      vertical-align: middle;
      margin-left: 4px;
      color: #ef6c00;
    }
    .chip-ok { --mdc-chip-label-text-color: #2e7d32; }
    .chip-missing { --mdc-chip-label-text-color: #d32f2f; }
  `]
})
export class AssignPartsDialogComponent implements OnInit {
  computerDisplayName = computerDisplayName;
  partDisplayLabel = partDisplayLabel;
  isUsedUntested = isUsedUntested;
  availableParts: Part[] = [];
  selectedIds = new Set<number>();
  /** Parts currently on this computer (stable list order; independent of checkbox toggles). */
  private assignedIds = new Set<number>();
  filter = '';
  showPlanned = false;
  requiredTypes: string[] = [];
  allTypes: string[] = [];
  placeholders: PartPlaceholder[] = [];
  newType = '';
  newDescription = '';
  savingPh = false;

  constructor(
    public dialogRef: MatDialogRef<AssignPartsDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { computer: Computer; lookups: Lookups },
    private apiService: ApiService,
    private snack: MatSnackBar
  ) {
    this.requiredTypes = sortTypeNames(
      data.lookups.types.filter(t => t.required).map(t => t.type)
    );
    this.allTypes = sortTypeNames(data.lookups.types.map(t => t.type));
    for (const p of data.computer.parts) {
      this.selectedIds.add(p.id);
      this.assignedIds.add(p.id);
    }
    this.placeholders = sortByPartType(data.computer.placeholders ?? []);
  }

  ngOnInit(): void {
    this.apiService.getParts({
      unassigned: true, includePlanned: true, excludeBad: true, excludeScam: true
    }).subscribe(parts => {
      const owned = this.data.computer.parts ?? [];
      const ownedIds = new Set(owned.map(p => p.id));
      this.availableParts = [
        ...owned,
        ...parts.filter(p => !ownedIds.has(p.id) && p.computerId !== this.data.computer.id && !isScamPart(p))
      ];
    });
    // Refresh placeholders in case the expand panel hasn't loaded detail yet.
    this.apiService.getComputer(this.data.computer.id).subscribe(detail => {
      this.placeholders = sortByPartType(detail.placeholders ?? []);
      this.data.computer.placeholders = this.placeholders;
      for (const p of detail.parts ?? []) {
        this.selectedIds.add(p.id);
        this.assignedIds.add(p.id);
      }
      if (detail.parts?.length) {
        const ownedIds = new Set(detail.parts.map(p => p.id));
        this.availableParts = [
          ...detail.parts,
          ...this.availableParts.filter(p => !ownedIds.has(p.id) && !isScamPart(p))
        ];
      }
    });
  }

  get filteredParts(): Part[] {
    const f = this.filter.toLowerCase();
    const list = !f
      ? this.availableParts
      : this.availableParts.filter(p =>
          p.type.toLowerCase().includes(f) ||
          (p.manufacturer ?? '').toLowerCase().includes(f) ||
          (p.modelNumber ?? '').toLowerCase().includes(f) ||
          (p.color ?? '').toLowerCase().includes(f) ||
          (p.location ?? '').toLowerCase().includes(f));
    // Hide scam parts from search unless already assigned to this computer.
    // Parts on other (Planned) PCs show only when opted in, or once picked.
    const visible = list.filter(p =>
      this.assignedIds.has(p.id) ||
      (!isScamPart(p) && (this.showPlanned || !this.isOnOtherComputer(p) || this.selectedIds.has(p.id))));
    const assigned = visible.filter(p => this.assignedIds.has(p.id));
    const other = visible.filter(p => !this.assignedIds.has(p.id));
    return [...sortByPartType(assigned), ...sortByPartType(other)];
  }

  hasType(type: string): boolean {
    if (this.placeholders.some(ph => ph.type === type)) return true;
    return this.availableParts.some(p => this.selectedIds.has(p.id) && p.type === type);
  }

  onInventoryPartClick(event: MouseEvent, part: Part): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.ctrlKey) {
      if (!openPartOrderUrl(part)) {
        this.snack.open('No URL', undefined, { duration: 2000 });
      }
      return;
    }
    if (!this.selectedIds.has(part.id) && !confirmReassignFromPlanned(part, this.data.computer.id)) return;
    this.toggle(part.id);
  }

  isOnOtherComputer(part: Part): boolean {
    return part.computerId != null && part.computerId !== this.data.computer.id;
  }

  toggle(id: number): void {
    if (this.selectedIds.has(id)) this.selectedIds.delete(id);
    else this.selectedIds.add(id);
  }

  addPlaceholder(): void {
    const description = this.newDescription.trim();
    if (!this.newType || !description) return;
    this.savingPh = true;
    this.apiService.addComputerPlaceholder(this.data.computer.id, this.newType, description).subscribe({
      next: ph => {
        this.placeholders = [...this.placeholders, ph];
        this.newDescription = '';
        this.savingPh = false;
      },
      error: err => {
        this.savingPh = false;
        this.snack.open(err.error?.message ?? 'Failed to add planned part', 'OK');
      }
    });
  }

  removePlaceholder(ph: PartPlaceholder): void {
    this.savingPh = true;
    this.apiService.deleteComputerPlaceholder(this.data.computer.id, ph.id).subscribe({
      next: () => {
        this.placeholders = this.placeholders.filter(p => p.id !== ph.id);
        this.savingPh = false;
      },
      error: err => {
        this.savingPh = false;
        this.snack.open(err.error?.message ?? 'Failed to remove planned part', 'OK');
      }
    });
  }

  save(): void {
    const takenFromIds = [...new Set(this.availableParts
      .filter(p => this.selectedIds.has(p.id) && this.isOnOtherComputer(p))
      .map(p => p.computerId!))];
    this.dialogRef.close({ partIds: [...this.selectedIds], placeholders: this.placeholders, takenFromIds });
  }
}
