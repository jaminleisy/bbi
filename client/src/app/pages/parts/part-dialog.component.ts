import { Component, Inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS, MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ApiService } from '../../services/api.service';
import { Lookups, Part, PartImageMeta } from '../../models';

export interface PartDialogData {
  part: Part | null;
  lookups: Lookups;
  /** Override dialog title (e.g. "Edit imported part"). */
  title?: string;
  /** When false, hides Split (used for import drafts). Default true. */
  allowSplit?: boolean;
  /** When true, shows Save+ to create another part with the same fields. */
  allowCreateAnother?: boolean;
  /** Optional preview image for drafts that are not yet saved (data URL or blob URL). */
  previewImageUrl?: string | null;
}

interface PreviewImage {
  meta: PartImageMeta;
  localUrl: string;
}

@Component({
  selector: 'app-part-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatCheckboxModule, MatDatepickerModule, MatIconModule,
    MatProgressSpinnerModule, MatTooltipModule],
  providers: [
    // Drop the empty hint/error slot under each field so the dialog fits without a v-scroll.
    { provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { appearance: 'outline', subscriptSizing: 'dynamic' } }
  ],
  template: `
    <h2 mat-dialog-title>{{ dialogTitle }}</h2>
    <mat-dialog-content>
      <div class="form-grid">
        <mat-form-field>
          <mat-label>Type</mat-label>
          <mat-select [(ngModel)]="model.type" required>
            @for (t of data.lookups.types; track t.type) {
              <mat-option [value]="t.type">{{ t.type }}{{ t.required ? ' *' : '' }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field>
          <mat-label>Manufacturer</mat-label>
          <input matInput [(ngModel)]="model.manufacturer">
        </mat-form-field>

        <mat-form-field>
          <mat-label>Model Number</mat-label>
          <input matInput [(ngModel)]="model.modelNumber">
        </mat-form-field>

        <mat-form-field>
          <mat-label>Cost</mat-label>
          <input matInput type="number" [(ngModel)]="model.cost">
          <span matTextPrefix>$&nbsp;</span>
        </mat-form-field>

        <mat-form-field>
          <mat-label>Order Date</mat-label>
          <input matInput [matDatepicker]="od" [(ngModel)]="model.orderDate">
          <mat-datepicker-toggle matIconSuffix [for]="od"></mat-datepicker-toggle>
          <mat-datepicker #od></mat-datepicker>
        </mat-form-field>

        <mat-form-field>
          <mat-label>Seller</mat-label>
          <mat-select [(ngModel)]="model.seller" (selectionChange)="onSellerChange($event.value)">
            <mat-option [value]="null">(none)</mat-option>
            @for (s of data.lookups.sellers; track s) {
              <mat-option [value]="s">{{ s }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field style="grid-column: span 2">
          <mat-label>Order URL</mat-label>
          <input matInput [(ngModel)]="model.orderUrl">
        </mat-form-field>

        <mat-form-field>
          <mat-label>Color</mat-label>
          <input matInput [(ngModel)]="model.color">
        </mat-form-field>

        <mat-form-field>
          <mat-label>Condition</mat-label>
          <mat-select [(ngModel)]="model.condition">
            <mat-option [value]="null">(none)</mat-option>
            @for (c of data.lookups.conditions; track c) {
              <mat-option [value]="c">{{ c }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field>
          <mat-label>CPU Socket</mat-label>
          <mat-select [(ngModel)]="model.cpuSocket">
            <mat-option [value]="null">(n/a)</mat-option>
            @for (s of data.lookups.cpuSockets; track s) {
              <mat-option [value]="s">{{ s }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field>
          <mat-label>PCIe Gen</mat-label>
          <mat-select [(ngModel)]="model.pcieGen">
            <mat-option [value]="null">(n/a)</mat-option>
            @for (s of data.lookups.pcieGens; track s) {
              <mat-option [value]="s">{{ s }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field>
          <mat-label>RAM Type</mat-label>
          <mat-select [(ngModel)]="model.ramType">
            <mat-option [value]="null">(n/a)</mat-option>
            @for (s of data.lookups.ramTypes; track s) {
              <mat-option [value]="s">{{ s }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field>
          <mat-label>Location</mat-label>
          <mat-select [(ngModel)]="model.location">
            <mat-option [value]="null">(none)</mat-option>
            @for (l of data.lookups.locations; track l) {
              <mat-option [value]="l">{{ l }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field>
          <mat-label>Return By Date</mat-label>
          <input matInput [matDatepicker]="rbd" [(ngModel)]="model.returnByDate">
          <mat-datepicker-toggle matIconSuffix [for]="rbd"></mat-datepicker-toggle>
          <mat-datepicker #rbd></mat-datepicker>
        </mat-form-field>

        <mat-form-field>
          <mat-label>Bad</mat-label>
          <mat-select [(ngModel)]="model.bad">
            <mat-option [value]="null">OK</mat-option>
            <mat-option [value]="1">Possibly bad</mat-option>
            <mat-option [value]="2">Confirmed bad</mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field>
          <mat-label>Scam</mat-label>
          <mat-select [(ngModel)]="model.scam">
            <mat-option [value]="null">OK</mat-option>
            <mat-option [value]="1">Possibly scam</mat-option>
            <mat-option [value]="2">Confirmed scam</mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field>
          <mat-label>Lost</mat-label>
          <mat-select [(ngModel)]="model.lost">
            <mat-option [value]="null">OK</mat-option>
            <mat-option [value]="1">Possibly lost</mat-option>
            <mat-option [value]="2">Confirmed lost</mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field>
          <mat-label>Merchant</mat-label>
          <input matInput [(ngModel)]="model.merchant" maxlength="100">
        </mat-form-field>

        <mat-form-field style="grid-column: span 2">
          <mat-label>Notes</mat-label>
          <textarea matInput rows="2" [(ngModel)]="model.notes"></textarea>
        </mat-form-field>

        <div class="checks">
          <mat-checkbox [(ngModel)]="model.hasRgb">Has RGB</mat-checkbox>
          <mat-checkbox [(ngModel)]="model.received">Received</mat-checkbox>
        </div>

        @if (model.id) {
          <div class="photos">
            <div class="photos-label">
              <mat-icon>photo_library</mat-icon>
              Photos
            </div>
            @if (photosLoading) {
              <div class="photos-status"><mat-spinner diameter="24"></mat-spinner></div>
            } @else if (!previews.length) {
              <div class="photos-status muted">No photos uploaded for this part.</div>
            } @else {
              <div class="thumbs">
                @for (img of previews; track img.meta.id) {
                  <button type="button" class="thumb" (click)="openLightbox(img)" aria-label="View photo">
                    <img [src]="img.localUrl" alt="Part photo">
                  </button>
                }
              </div>
            }
          </div>
        } @else if (data.previewImageUrl) {
          <div class="photos">
            <div class="photos-label">
              <mat-icon>photo_library</mat-icon>
              From PDF
            </div>
            <div class="thumbs">
              <button type="button" class="thumb" (click)="openPreviewLightbox()" aria-label="View photo">
                <img [src]="data.previewImageUrl" alt="Product from PDF">
              </button>
            </div>
          </div>
        }
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (canSplit) {
        <button mat-stroked-button type="button" class="split-btn" (click)="saveAndSplit()"
                matTooltip="Save, then split this part">
          <mat-icon>call_split</mat-icon> Split
        </button>
      }
      <span class="spacer"></span>
      <button mat-button mat-dialog-close>Cancel</button>
      @if (canCreateAnother) {
        <button mat-stroked-button color="primary" [disabled]="!model.type"
                (click)="saveAndCreateAnother()"
                matTooltip="Save, then open another New Part with the same fields">
          Save+
        </button>
      }
      <button mat-flat-button color="primary" [disabled]="!model.type" (click)="save()">Save</button>
    </mat-dialog-actions>

    @if (lightboxUrl) {
      <div class="lightbox" (click)="closeLightbox()" role="dialog" aria-modal="true" aria-label="Photo preview">
        <button mat-icon-button type="button" class="lightbox-close" (click)="closeLightbox()" aria-label="Close">
          <mat-icon>close</mat-icon>
        </button>
        <img [src]="lightboxUrl" alt="Part photo enlarged" (click)="$event.stopPropagation()">
      </div>
    }
  `,
  styles: [`
    :host {
      display: block;
      position: relative;
    }
    .form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      column-gap: 10px;
      row-gap: 10px;
      width: min(440px, calc(100vw - 48px));
      max-width: 100%;
      padding-top: 4px;
      box-sizing: border-box;
    }
    @media (max-width: 480px) {
      .form-grid { grid-template-columns: 1fr; }
      .checks { grid-column: 1 / -1; }
    }
    .form-grid mat-form-field {
      width: 100%;
      min-width: 0;
    }
    .checks {
      display: flex;
      gap: 24px;
      align-items: center;
      grid-column: span 2;
    }
    .photos {
      grid-column: 1 / -1;
      margin-top: 4px;
    }
    .photos-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: #555;
      margin-bottom: 8px;
    }
    .photos-label mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    .photos-status {
      display: flex;
      align-items: center;
      min-height: 32px;
      font-size: 13px;
    }
    .muted { color: #888; }
    .thumbs {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .thumb {
      width: 88px;
      height: 88px;
      padding: 0;
      border: 1px solid #ddd;
      border-radius: 6px;
      overflow: hidden;
      background: #f5f5f5;
      cursor: pointer;
    }
    .thumb:hover { border-color: #90caf9; }
    .thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .lightbox {
      position: fixed;
      inset: 0;
      z-index: 1000;
      background: rgba(0, 0, 0, 0.85);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 48px 16px 16px;
      box-sizing: border-box;
    }
    .lightbox img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border-radius: 4px;
    }
    .lightbox-close {
      position: absolute;
      top: 8px;
      right: 8px;
      color: #fff;
      background: rgba(0, 0, 0, 0.35);
    }
    :host ::ng-deep mat-dialog-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      align-items: center;
    }
    .spacer { flex: 1 1 auto; min-width: 8px; }
  `]
})
export class PartDialogComponent implements OnInit, OnDestroy {
  model: Partial<Part>;
  private isNew: boolean;
  previews: PreviewImage[] = [];
  photosLoading = false;
  lightboxUrl: string | null = null;

  constructor(
    public dialogRef: MatDialogRef<PartDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: PartDialogData,
    private api: ApiService,
    private http: HttpClient
  ) {
    // Prefill for Save+ has fields but no id — still treat as new.
    this.isNew = data.part == null || data.part.id == null || data.part.id === 0;
    this.model = data.part
      ? {
          ...data.part,
          ...(this.isNew ? { id: undefined } : {}),
          bad: data.part.bad ?? null,
          scam: data.part.scam ?? null,
          lost: data.part.lost ?? null
        }
      : { hasRgb: false, received: false, condition: 'New', bad: null, scam: null, lost: null,
          orderDate: new Date() as unknown as string };
  }

  ngOnInit(): void {
    if (!this.model.id) return;
    this.photosLoading = true;
    this.api.listPartImages(this.model.id).subscribe({
      next: metas => {
        if (!metas.length) {
          this.photosLoading = false;
          return;
        }
        let remaining = metas.length;
        for (const meta of metas) {
          const url = this.api.partImageUrl(this.model.id!, meta.id);
          this.http.get(url, { responseType: 'blob' }).subscribe({
            next: blob => {
              this.previews.push({ meta, localUrl: URL.createObjectURL(blob) });
              remaining--;
              if (remaining <= 0) this.photosLoading = false;
            },
            error: () => {
              remaining--;
              if (remaining <= 0) this.photosLoading = false;
            }
          });
        }
      },
      error: () => {
        this.photosLoading = false;
      }
    });
  }

  ngOnDestroy(): void {
    for (const p of this.previews) {
      if (p.localUrl.startsWith('blob:')) URL.revokeObjectURL(p.localUrl);
    }
  }

  onSellerChange(seller: string | null): void {
    // Only auto-default condition while creating a new part.
    if (!this.isNew) return;
    this.model.condition = seller === 'eBay' ? 'Used' : 'New';
  }

  get dialogTitle(): string {
    if (this.data.title) return this.data.title;
    return this.model.id ? 'Edit Part' : 'New Part';
  }

  get canSplit(): boolean {
    if (this.data.allowSplit === false) return false;
    return !!this.model.type && this.model.cost != null && !Number.isNaN(Number(this.model.cost));
  }

  get canCreateAnother(): boolean {
    return this.isNew && this.data.allowCreateAnother === true;
  }

  openLightbox(img: PreviewImage): void {
    this.lightboxUrl = img.localUrl;
  }

  openPreviewLightbox(): void {
    this.lightboxUrl = this.data.previewImageUrl ?? null;
  }

  closeLightbox(): void {
    this.lightboxUrl = null;
  }

  save(): void {
    this.dialogRef.close(this.model);
  }

  /** Save (create), then open another New Part dialog with the same fields. */
  saveAndCreateAnother(): void {
    if (!this.canCreateAnother) return;
    this.dialogRef.close({ ...this.model, createAnother: true });
  }

  /** Save (create or update), then open the split flow on the Parts page. */
  saveAndSplit(): void {
    if (!this.canSplit) return;
    this.dialogRef.close({ ...this.model, splitAfterSave: true });
  }
}
