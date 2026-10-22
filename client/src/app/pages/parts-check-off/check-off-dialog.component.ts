import { Component, ElementRef, Inject, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatRadioModule } from '@angular/material/radio';
import { ApiService } from '../../services/api.service';
import { CheckOffTestOutcome, Part, PartImageMeta } from '../../models';
import { partModelText } from '../../part-display';

export interface CheckOffDialogData {
  part: Part;
  mode: 'notReceived' | 'untested' | 'transfer';
}

interface PreviewImage {
  meta?: PartImageMeta;
  localUrl: string;
  uploading?: boolean;
  file?: File;
}

@Component({
  selector: 'app-check-off-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule,
    MatInputModule, MatIconModule, MatProgressSpinnerModule, MatSnackBarModule, MatRadioModule
  ],
  template: `
    <h2 mat-dialog-title>
      @if (data.mode === 'notReceived') {
        Receive Part
      } @else if (data.mode === 'untested') {
        Test Part
      } @else {
        Transfer Part
      }
    </h2>
    <mat-dialog-content>
      <dl class="info">
        <div><dt>Type</dt><dd>{{ part.type }}</dd></div>
        <div><dt>Manufacturer</dt><dd>{{ part.manufacturer || '—' }}</dd></div>
        <div><dt>Model</dt><dd>{{ partModelText(part) }}</dd></div>
        @if (data.mode === 'transfer') {
          <div><dt>At</dt><dd>{{ part.location || '—' }}</dd></div>
          <div><dt>Belongs at</dt><dd>{{ part.computerLocation || '—' }}</dd></div>
          <div><dt>Build</dt><dd>{{ part.computerName || '—' }}</dd></div>
        } @else {
          <div><dt>Order date</dt><dd>{{ part.orderDate ? (part.orderDate | date:'mediumDate') : '—' }}</dd></div>
          <div><dt>Seller</dt><dd>{{ part.seller || '—' }}</dd></div>
          <div><dt>Condition</dt><dd>{{ part.condition || '—' }}</dd></div>
        }
        <div>
          <dt>Order URL</dt>
          <dd>
            @if (part.orderUrl) {
              <a class="order-link" [href]="part.orderUrl" target="_blank" rel="noopener">
                Open
                <mat-icon>open_in_new</mat-icon>
              </a>
            } @else {
              —
            }
          </dd>
        </div>
        <div class="listing-row">
          <dt>Listing photo</dt>
          <dd>
            @if (listingPreviews.length) {
              <div class="listing-thumbs">
                @for (img of listingPreviews; track trackPreview(img)) {
                  <button type="button" class="listing-thumb" (click)="openLightbox(img.localUrl)" aria-label="View listing photo">
                    <img [src]="img.localUrl" alt="Imported listing photo">
                  </button>
                }
              </div>
            } @else {
              —
            }
          </dd>
        </div>
      </dl>

      @if (data.mode === 'untested') {
        <div class="outcome-block">
          <div class="section-label">Test result</div>
          <mat-radio-group [(ngModel)]="outcome" class="outcome-group">
            <mat-radio-button value="good">Tested — good</mat-radio-button>
            <mat-radio-button value="possiblyBad">Tested — possibly bad</mat-radio-button>
            <mat-radio-button value="definitelyBad">Tested — definitely bad</mat-radio-button>
            <mat-radio-button value="scam">Scam</mat-radio-button>
          </mat-radio-group>
        </div>

        <mat-form-field appearance="outline" class="notes-field">
          <mat-label>Notes</mat-label>
          <textarea matInput rows="3" [(ngModel)]="notes"></textarea>
        </mat-form-field>
      }

      @if (data.mode === 'transfer') {
        @if (previews.length) {
          <div class="photos">
            <div class="section-label">Photos</div>
            <div class="thumbs">
              @for (img of previews; track trackPreview(img)) {
                <button type="button" class="thumb thumb-view" (click)="openLightbox(img.localUrl)" aria-label="View photo">
                  <img [src]="img.localUrl" alt="Part photo">
                </button>
              }
            </div>
          </div>
        }
      } @else {
        <div class="photos">
          <div class="section-label">Photos (optional)</div>
          <div class="photo-actions">
            <button mat-stroked-button type="button" (click)="fileInput.click()" [disabled]="busy">
              <mat-icon>photo_camera</mat-icon>
              Take / add photos
            </button>
            <input #fileInput type="file" accept="image/*" capture="environment" multiple hidden
                   (change)="onFilesSelected($event)">
          </div>

          @if (previews.length) {
            <div class="thumbs">
              @for (img of previews; track trackPreview(img); let i = $index) {
                <div class="thumb">
                  <img [src]="img.localUrl" alt="Part photo">
                  @if (img.uploading) {
                    <div class="thumb-busy"><mat-spinner diameter="24"></mat-spinner></div>
                  } @else {
                    <button mat-icon-button class="thumb-del" type="button"
                            (click)="removePreview(i)" aria-label="Remove photo">
                      <mat-icon>close</mat-icon>
                    </button>
                  }
                </div>
              }
            </div>
          }
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="actions">
      <button mat-button mat-dialog-close [disabled]="busy">Cancel</button>
      @if (data.mode === 'notReceived') {
        @if (isNewCondition) {
          <button mat-stroked-button color="primary" class="receive-btn"
                  [disabled]="busy" (click)="markReceived(true)">
            @if (busy) { <mat-spinner diameter="20"></mat-spinner> }
            @else { Received - is used }
          </button>
        }
        <button mat-flat-button color="primary" class="receive-btn"
                [disabled]="busy" (click)="markReceived(false)">
          @if (busy) { <mat-spinner diameter="20"></mat-spinner> }
          @else { Received }
        </button>
      } @else if (data.mode === 'untested') {
        <button mat-flat-button color="primary" [disabled]="busy || !outcome" (click)="markTested()">
          @if (busy) { <mat-spinner diameter="20"></mat-spinner> }
          @else { Save result }
        </button>
      } @else {
        <button mat-flat-button color="primary"
                [disabled]="busy || !part.computerLocation"
                (click)="markTransferred()">
          @if (busy) { <mat-spinner diameter="20"></mat-spinner> }
          @else { Mark at {{ part.computerLocation }} }
        </button>
      }
    </mat-dialog-actions>

    @if (lightboxUrl) {
      <div class="lightbox" (click)="closeLightbox()" role="dialog" aria-modal="true" aria-label="Photo preview">
        <button mat-icon-button type="button" class="lightbox-close" (click)="closeLightbox()" aria-label="Close">
          <mat-icon>close</mat-icon>
        </button>
        <img [src]="lightboxUrl" alt="Listing photo enlarged" (click)="$event.stopPropagation()">
      </div>
    }
  `,
  styles: [`
    :host { display: block; position: relative; }
    .info {
      display: grid;
      gap: 8px;
      margin: 0 0 16px;
    }
    .info > div {
      display: grid;
      grid-template-columns: 110px 1fr;
      gap: 8px;
      font-size: 14px;
    }
    dt { margin: 0; color: #777; font-weight: 500; }
    dd { margin: 0; word-break: break-word; }
    .listing-row { align-items: start; }
    .listing-thumbs {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .listing-thumb {
      width: 90px;
      height: 90px;
      padding: 0;
      border: 1px solid #ddd;
      border-radius: 6px;
      overflow: hidden;
      background: #f5f5f5;
      cursor: pointer;
    }
    .listing-thumb:hover { border-color: #90caf9; }
    .listing-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .order-link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: #1565c0;
      text-decoration: none;
      font-weight: 500;
    }
    .order-link:hover { text-decoration: underline; }
    .order-link mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .section-label {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: #555;
      margin-bottom: 8px;
    }
    .outcome-block { margin-bottom: 12px; }
    .outcome-group {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
    }
    .notes-field { width: 100%; }
    .photos { margin-top: 8px; }
    .photo-actions { margin-bottom: 10px; }
    .thumbs {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .thumb {
      position: relative;
      width: 88px;
      height: 88px;
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid #ddd;
      background: #f5f5f5;
    }
    .thumb-view {
      padding: 0;
      cursor: pointer;
    }
    .thumb-view:hover { border-color: #90caf9; }
    .thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .thumb-del {
      position: absolute;
      top: 0;
      right: 0;
      background: rgba(0,0,0,0.45);
      color: #fff;
      width: 28px;
      height: 28px;
      padding: 0;
    }
    .thumb-busy {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255,255,255,0.65);
    }
    .actions {
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 4px;
      padding-top: 12px;
      border-top: 1px solid #e0e0e0;
    }
    .actions ::ng-deep .mdc-button {
      padding-left: 10px;
      padding-right: 10px;
      min-width: 0;
    }
    .actions ::ng-deep .receive-btn.mdc-button {
      padding-left: 14px;
      padding-right: 14px;
    }
    .lightbox {
      position: fixed;
      inset: 0;
      z-index: 1000;
      background: rgba(0,0,0,0.82);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .lightbox img {
      max-width: min(920px, 100%);
      max-height: 90vh;
      object-fit: contain;
      border-radius: 4px;
    }
    .lightbox-close {
      position: absolute;
      top: 12px;
      right: 12px;
      color: #fff;
    }
  `]
})
export class CheckOffDialogComponent implements OnInit, OnDestroy {
  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;

  partModelText = partModelText;
  part: Part;
  notes = '';
  outcome: CheckOffTestOutcome | null = null;
  /** Photos from PDF import (source=import) — shown in the info table. */
  listingPreviews: PreviewImage[] = [];
  /** User check-off photos (receiving / testing) — shown in Photos. */
  previews: PreviewImage[] = [];
  lightboxUrl: string | null = null;
  busy = false;
  private pendingFiles: File[] = [];

  get isNewCondition(): boolean {
    return (this.part.condition ?? '').trim().toLowerCase() === 'new';
  }

  constructor(
    public dialogRef: MatDialogRef<CheckOffDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: CheckOffDialogData,
    private api: ApiService,
    private http: HttpClient,
    private snack: MatSnackBar
  ) {
    this.part = data.part;
    this.notes = data.part.notes ?? '';
  }

  ngOnInit(): void {
    this.api.listPartImages(this.part.id).subscribe({
      next: metas => {
        for (const meta of metas) this.loadRemotePreview(meta);
      }
    });
  }

  ngOnDestroy(): void {
    for (const p of [...this.previews, ...this.listingPreviews]) {
      if (p.localUrl.startsWith('blob:')) URL.revokeObjectURL(p.localUrl);
    }
  }

  trackPreview(img: PreviewImage): string {
    return img.meta ? `m-${img.meta.id}` : img.localUrl;
  }

  openLightbox(url: string): void {
    this.lightboxUrl = url;
  }

  closeLightbox(): void {
    this.lightboxUrl = null;
  }

  private loadRemotePreview(meta: PartImageMeta): void {
    const url = this.api.partImageUrl(this.part.id, meta.id);
    this.http.get(url, { responseType: 'blob' }).subscribe({
      next: blob => {
        const preview: PreviewImage = {
          meta,
          localUrl: URL.createObjectURL(blob)
        };
        if ((meta.source ?? '').toLowerCase() === 'import') {
          this.listingPreviews.push(preview);
        } else {
          this.previews.push(preview);
        }
      }
    });
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      this.pendingFiles.push(file);
      this.previews.push({
        localUrl: URL.createObjectURL(file),
        file
      });
    }
  }

  removePreview(index: number): void {
    const img = this.previews[index];
    if (!img) return;
    if (img.meta) {
      this.api.deletePartImage(this.part.id, img.meta.id).subscribe({
        next: () => {
          if (img.localUrl.startsWith('blob:')) URL.revokeObjectURL(img.localUrl);
          this.previews.splice(index, 1);
        },
        error: () => this.snack.open('Failed to delete photo', 'OK')
      });
      return;
    }
    if (img.file) {
      this.pendingFiles = this.pendingFiles.filter(f => f !== img.file);
    }
    if (img.localUrl.startsWith('blob:')) URL.revokeObjectURL(img.localUrl);
    this.previews.splice(index, 1);
  }

  private async uploadPending(): Promise<boolean> {
    const files = [...this.pendingFiles];
    this.pendingFiles = [];
    for (const file of files) {
      const preview = this.previews.find(p => p.file === file);
      if (preview) preview.uploading = true;
      try {
        const meta = await new Promise<PartImageMeta>((resolve, reject) => {
          const source = this.data.mode === 'untested' ? 'testing' : 'receiving';
          this.api.uploadPartImage(this.part.id, file, source).subscribe({ next: resolve, error: reject });
        });
        if (preview) {
          preview.meta = meta;
          preview.file = undefined;
          preview.uploading = false;
        }
      } catch {
        if (preview) preview.uploading = false;
        this.snack.open('Failed to upload a photo', 'OK');
        return false;
      }
    }
    return true;
  }

  markReceived(appearsUsed = false): void {
    this.busy = true;
    this.uploadPending().then(ok => {
      if (!ok) {
        this.busy = false;
        return;
      }
      this.api.markReceived(this.part.id, true, appearsUsed).subscribe({
        next: () => {
          this.busy = false;
          this.snack.open(
            appearsUsed ? 'Marked received (condition set to Used)' : 'Part marked received',
            undefined,
            { duration: 2000 }
          );
          this.dialogRef.close(true);
        },
        error: err => {
          this.busy = false;
          this.snack.open(err.error?.message ?? 'Failed to mark received', 'OK');
        }
      });
    });
  }

  markTested(): void {
    if (!this.outcome) return;
    this.busy = true;
    this.uploadPending().then(ok => {
      if (!ok) {
        this.busy = false;
        return;
      }
      this.api.checkOffTest(this.part.id, this.outcome!, this.notes).subscribe({
        next: () => {
          this.busy = false;
          this.snack.open('Test result saved', undefined, { duration: 2000 });
          this.dialogRef.close(true);
        },
        error: err => {
          this.busy = false;
          this.snack.open(err.error?.message ?? 'Failed to save test result', 'OK');
        }
      });
    });
  }

  markTransferred(): void {
    const dest = (this.part.computerLocation ?? '').trim();
    if (!dest) return;
    this.busy = true;
    this.api.setPartLocation(this.part.id, dest).subscribe({
      next: () => {
        this.busy = false;
        this.snack.open(`Part location set to ${dest}`, undefined, { duration: 2000 });
        this.dialogRef.close(true);
      },
      error: err => {
        this.busy = false;
        this.snack.open(err.error?.message ?? 'Failed to update location', 'OK');
      }
    });
  }
}
