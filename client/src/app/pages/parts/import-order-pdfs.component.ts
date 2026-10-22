import { Component, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule, MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ApiService, ParsedPartDraft, ParseOrderPdfFileResult } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { Lookups, Part } from '../../models';
import { PartDialogComponent } from './part-dialog.component';

interface ImportDraft {
  key: string;
  selected: boolean;
  isDuplicate: boolean;
  part: Partial<Part>;
  quantity: number;
  sourceFileName: string;
  imageDataUrl: string | null;
}

@Component({
  selector: 'app-import-order-pdfs',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterLink, CurrencyPipe, DatePipe,
    MatButtonModule, MatIconModule, MatCheckboxModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatProgressSpinnerModule, MatSnackBarModule, MatDialogModule, MatTooltipModule
  ],
  providers: [
    { provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { appearance: 'outline', subscriptSizing: 'dynamic' } }
  ],
  template: `
    <div class="page-container">
      <div class="header-row">
        <div class="title-block">
          <a mat-button routerLink="/parts" class="back-link">
            <mat-icon>arrow_back</mat-icon> Parts
          </a>
          <h1>Import eBay PDFs</h1>
        </div>
        <span class="spacer"></span>
        @if (drafts.length) {
          <button mat-stroked-button type="button" (click)="reset()" [disabled]="busy">
            Start over
          </button>
        }
      </div>

      @if (!drafts.length) {
        <section class="upload-panel">
          <p class="hint">
            Select one or more eBay order receipt PDFs (printer-friendly / selectable text).
            Files are parsed in memory and not saved. Review each part below, edit if needed, then create.
          </p>
          <input #fileInput type="file" accept="application/pdf,.pdf" multiple hidden
                 (change)="onFilesPicked($event)">
          <div class="pick-row">
            <button mat-stroked-button type="button" (click)="fileInput.click()" [disabled]="busy">
              <mat-icon>upload_file</mat-icon> Choose PDFs
            </button>
            @if (pickedFiles.length) {
              <span class="file-count">{{ pickedFiles.length }} file{{ pickedFiles.length === 1 ? '' : 's' }} selected</span>
            }
            <button mat-flat-button color="primary" type="button"
                    [disabled]="!pickedFiles.length || busy" (click)="parse()">
              @if (busy) {
                <mat-spinner diameter="18"></mat-spinner>
              } @else {
                Parse
              }
            </button>
          </div>
          @if (pickedFiles.length) {
            <ul class="file-list">
              @for (f of pickedFiles; track f.name + f.size) {
                <li>{{ f.name }} <span class="muted">({{ formatSize(f.size) }})</span></li>
              }
            </ul>
          }
          @if (parseErrors.length) {
            <div class="errors">
              @for (e of parseErrors; track e) {
                <div>{{ e }}</div>
              }
            </div>
          }
          @if (fileSummaries.length) {
            <div class="file-summaries">
              @for (s of fileSummaries; track s) {
                <div class="muted">{{ s }}</div>
              }
            </div>
          }
        </section>
      } @else {
        @if (fileSummaries.length) {
          <div class="file-summaries top">
            @for (s of fileSummaries; track s) {
              <div class="muted">{{ s }}</div>
            }
          </div>
        }
        @if (parseErrors.length) {
          <div class="errors">
            @for (e of parseErrors; track e) {
              <div>{{ e }}</div>
            }
          </div>
        }

        <div class="draft-list">
          @for (d of drafts; track d.key; let i = $index) {
            <article class="draft-card" [class.deselected]="!d.selected" [class.duplicate]="d.isDuplicate" [class.collapsed]="!d.selected">
              @if (!d.selected) {
                <div class="collapsed-row">
                  <mat-checkbox [(ngModel)]="d.selected" [ngModelOptions]="{standalone: true}">
                    Import
                  </mat-checkbox>
                  <div class="collapsed-thumb">
                    @if (d.imageDataUrl) {
                      <img [src]="d.imageDataUrl" alt="">
                    } @else {
                      <mat-icon>image_not_supported</mat-icon>
                    }
                  </div>
                  <div class="collapsed-summary">
                    <div class="collapsed-title">
                      @if (d.isDuplicate) {
                        <span class="dup-tag">Duplicate</span>
                      }
                      {{ d.part.modelNumber || d.part.manufacturer || 'Untitled part' }}
                    </div>
                    <div class="muted">
                      {{ d.part.type || 'no type' }}
                      · {{ d.part.cost != null ? (d.part.cost | currency) : '—' }}
                      · {{ d.part.orderDate ? (d.part.orderDate | date:'mediumDate') : 'no date' }}
                    </div>
                  </div>
                  <button mat-icon-button type="button" (click)="removeDraft(i)"
                          matTooltip="Remove this draft" [disabled]="busy" aria-label="Remove">
                    <mat-icon>delete</mat-icon>
                  </button>
                </div>
              } @else {
                <div class="preview">
                  <div class="thumb">
                    @if (d.imageDataUrl) {
                      <img [src]="d.imageDataUrl" alt="Product from PDF">
                    } @else {
                      <div class="thumb-empty">
                        <mat-icon>image_not_supported</mat-icon>
                        <span>No image in PDF</span>
                      </div>
                    }
                  </div>
                  <div class="details">
                    @if (d.isDuplicate) {
                      <div class="duplicate-banner">
                        <mat-icon>warning</mat-icon>
                        <span>
                          Duplicate order
                          @if (d.part.orderUrl) {
                            — this order number already appears on an existing part’s Order URL.
                          }
                          Unchecked by default; check “Import” if you still want to import it.
                        </span>
                      </div>
                    }
                    <div class="actions-row">
                      <mat-checkbox [(ngModel)]="d.selected" [ngModelOptions]="{standalone: true}">
                        Import
                      </mat-checkbox>
                      <span class="spacer"></span>
                      <button mat-stroked-button type="button" (click)="editDraft(i)" [disabled]="busy">
                        <mat-icon>edit</mat-icon> Edit
                      </button>
                      <button mat-icon-button type="button" (click)="removeDraft(i)"
                              matTooltip="Remove this draft" [disabled]="busy" aria-label="Remove">
                        <mat-icon>delete</mat-icon>
                      </button>
                    </div>

                    @if (d.quantity > 1) {
                      <p class="qty-note">Qty {{ d.quantity }} — will create one part row with the line total cost</p>
                    }

                    <div class="edit-grid">
                      <mat-form-field>
                        <mat-label>Type</mat-label>
                        <mat-select [(ngModel)]="d.part.type" [ngModelOptions]="{standalone: true}" required
                                    [class.warn-select]="!d.part.type">
                          <mat-option value="">(required)</mat-option>
                          @for (t of lookups?.types ?? []; track t.type) {
                            <mat-option [value]="t.type">{{ t.type }}</mat-option>
                          }
                        </mat-select>
                      </mat-form-field>
                      <mat-form-field>
                        <mat-label>Manufacturer</mat-label>
                        <input matInput [(ngModel)]="d.part.manufacturer" [ngModelOptions]="{standalone: true}" maxlength="100">
                      </mat-form-field>
                      <mat-form-field class="span2">
                        <mat-label>Model</mat-label>
                        <input matInput [(ngModel)]="d.part.modelNumber" [ngModelOptions]="{standalone: true}" maxlength="100">
                      </mat-form-field>
                      <mat-form-field>
                        <mat-label>Condition</mat-label>
                        <mat-select [(ngModel)]="d.part.condition" [ngModelOptions]="{standalone: true}">
                          <mat-option [value]="null">(none)</mat-option>
                          @for (c of lookups?.conditions ?? []; track c) {
                            <mat-option [value]="c">{{ c }}</mat-option>
                          }
                        </mat-select>
                      </mat-form-field>
                      <mat-form-field>
                        <mat-label>Color</mat-label>
                        <input matInput [(ngModel)]="d.part.color" [ngModelOptions]="{standalone: true}" maxlength="50">
                      </mat-form-field>
                    </div>

                    <dl class="facts">
                      <div><dt>Cost</dt><dd>{{ d.part.cost != null ? (d.part.cost | currency) : '—' }}</dd></div>
                      <div><dt>Order date</dt><dd>{{ d.part.orderDate ? (d.part.orderDate | date:'mediumDate') : '—' }}</dd></div>
                      <div><dt>Seller</dt><dd>{{ d.part.seller || '—' }}</dd></div>
                      <div><dt>Merchant</dt><dd>{{ d.part.merchant || '—' }}</dd></div>
                      <div><dt>Location</dt><dd>{{ d.part.location || '—' }}</dd></div>
                      <div class="wide"><dt>Order URL</dt>
                        <dd>
                          @if (d.part.orderUrl) {
                            <a [href]="d.part.orderUrl" target="_blank" rel="noopener">{{ d.part.orderUrl }}</a>
                          } @else { — }
                        </dd>
                      </div>
                      <div class="wide"><dt>Source PDF</dt><dd>{{ d.sourceFileName || '—' }}</dd></div>
                    </dl>
                  </div>
                </div>
              }
            </article>
          }
        </div>

        <div class="footer-actions">
          <span class="muted ready-hint">
            @if (!canCreate) {
              Set Type on every selected part before importing.
            } @else {
              {{ selectedCount }} selected
            }
          </span>
          <span class="spacer"></span>
          <button mat-flat-button color="primary" type="button"
                  [disabled]="!canCreate || busy" (click)="create()">
            @if (busy) {
              <mat-spinner diameter="18"></mat-spinner>
            } @else {
              Import selected ({{ selectedCount }})
            }
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    .header-row { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
    .title-block { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .title-block h1 { margin: 0; font-size: 1.5rem; }
    .back-link { margin-left: -8px; }
    .spacer { flex: 1; }
    .hint { margin: 0 0 14px; color: #555; font-size: 14px; line-height: 1.45; max-width: 52rem; }
    .upload-panel {
      border: 1px solid #e0e0e0;
      border-radius: 10px;
      padding: 20px;
      background: #fafafa;
    }
    .pick-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
    .pick-row mat-spinner { display: inline-block; }
    .file-count { font-size: 13px; }
    .file-list { margin: 0 0 8px; padding-left: 18px; font-size: 13px; }
    .muted { color: #777; font-size: 13px; }
    .errors { color: #b71c1c; font-size: 13px; margin: 8px 0; display: flex; flex-direction: column; gap: 4px; }
    .file-summaries { margin: 8px 0 12px; }
    .file-summaries.top { margin-top: 0; }
    .draft-list {
      display: flex;
      flex-direction: column;
      gap: 14px;
      margin-bottom: 16px;
    }
    .draft-card {
      border: 1px solid #e0e0e0;
      border-radius: 10px;
      padding: 14px;
      background: #fafafa;
    }
    .draft-card.deselected { opacity: 0.85; }
    .draft-card.collapsed {
      padding: 8px 12px;
      background: #f5f5f5;
    }
    .draft-card.duplicate { border-color: #ffcc80; }
    .collapsed-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .collapsed-thumb {
      flex: 0 0 48px;
      width: 48px;
      height: 48px;
      border-radius: 6px;
      overflow: hidden;
      background: #eee;
      border: 1px solid #e0e0e0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #9e9e9e;
    }
    .collapsed-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .collapsed-thumb mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .collapsed-summary { flex: 1; min-width: 0; }
    .collapsed-title {
      font-size: 14px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .dup-tag {
      display: inline-block;
      margin-right: 6px;
      padding: 1px 6px;
      border-radius: 4px;
      background: #fff3e0;
      color: #e65100;
      font-size: 11px;
      font-weight: 600;
      vertical-align: middle;
    }
    .duplicate-banner {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-bottom: 12px;
      padding: 10px 12px;
      border-radius: 8px;
      background: #fff3e0;
      border: 1px solid #ffcc80;
      color: #e65100;
      font-size: 13px;
      line-height: 1.4;
    }
    .duplicate-banner mat-icon {
      flex: 0 0 auto;
      color: #ef6c00;
    }
    .preview { display: flex; gap: 20px; align-items: flex-start; }
    .thumb {
      flex: 0 0 160px;
      width: 160px;
      height: 160px;
      border-radius: 8px;
      overflow: hidden;
      background: #eee;
      border: 1px solid #e0e0e0;
    }
    .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .thumb-empty {
      width: 100%; height: 100%;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 6px; color: #9e9e9e; font-size: 12px; text-align: center; padding: 8px;
    }
    .details { flex: 1; min-width: 0; }
    .actions-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
    .qty-note { margin: 0 0 10px; font-size: 13px; color: #1565c0; }
    .edit-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px 12px;
      margin-bottom: 8px;
    }
    .edit-grid .span2 { grid-column: span 2; }
    .edit-grid mat-form-field { width: 100%; }
    .facts {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px 16px;
      margin: 0;
    }
    .facts > div { min-width: 0; }
    .facts .wide { grid-column: 1 / -1; }
    .facts dt {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #777;
      margin-bottom: 2px;
    }
    .facts dd { margin: 0; font-size: 14px; word-break: break-word; }
    .facts a { color: #1565c0; }
    .footer-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      padding-top: 8px;
      border-top: 1px solid #eee;
      position: sticky;
      bottom: 0;
      background: #fff;
      padding-bottom: 8px;
    }
    .footer-actions mat-spinner { display: inline-block; margin: 0 8px; }
    .ready-hint { max-width: 28rem; }
    @media (max-width: 720px) {
      .preview { flex-direction: column; }
      .thumb { width: 100%; max-width: 240px; height: 180px; flex-basis: auto; }
      .edit-grid { grid-template-columns: 1fr; }
      .edit-grid .span2 { grid-column: auto; }
      .facts { grid-template-columns: 1fr; }
      .facts .wide { grid-column: auto; }
    }
  `]
})
export class ImportOrderPdfsComponent implements OnInit {
  lookups: Lookups | null = null;
  pickedFiles: File[] = [];
  drafts: ImportDraft[] = [];
  fileSummaries: string[] = [];
  parseErrors: string[] = [];
  busy = false;
  private draftSeq = 0;

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private dialog: MatDialog,
    private snack: MatSnackBar,
    private router: Router
  ) {}

  ngOnInit(): void {
    if (!this.auth.canEditParts()) {
      this.snack.open('You need edit permission to import parts.', 'OK');
      void this.router.navigate(['/parts']);
      return;
    }
    this.api.getLookups().subscribe({
      next: l => this.lookups = l,
      error: () => this.snack.open('Failed to load lookups', 'OK')
    });
  }

  get selectedCount(): number {
    return this.drafts.filter(d => d.selected).length;
  }

  get canCreate(): boolean {
    const selected = this.drafts.filter(d => d.selected);
    return selected.length > 0 && selected.every(d => !!d.part.type?.trim());
  }

  onFilesPicked(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    this.pickedFiles = Array.from(input.files ?? []).filter(f =>
      f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    this.parseErrors = [];
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  reset(): void {
    this.drafts = [];
    this.pickedFiles = [];
    this.fileSummaries = [];
    this.parseErrors = [];
  }

  parse(): void {
    if (!this.pickedFiles.length || this.busy) return;
    this.busy = true;
    this.parseErrors = [];
    this.api.parseOrderPdfs(this.pickedFiles).subscribe({
      next: res => {
        this.busy = false;
        const drafts: ImportDraft[] = [];
        const summaries: string[] = [];
        const errors: string[] = [];
        for (const file of res.files ?? []) {
          this.collectFileResult(file, drafts, summaries, errors);
        }
        this.fileSummaries = summaries;
        this.parseErrors = errors;
        if (!drafts.length) {
          this.snack.open(errors[0] ?? 'No parts found in the selected PDFs.', 'OK');
          return;
        }
        this.drafts = this.sortDraftsByOrderDate(drafts);
      },
      error: err => {
        this.busy = false;
        this.snack.open(err.error?.message ?? 'Parse failed', 'OK');
      }
    });
  }

  private sortDraftsByOrderDate(drafts: ImportDraft[]): ImportDraft[] {
    return [...drafts].sort((a, b) => {
      const ta = this.orderDateMs(a.part.orderDate);
      const tb = this.orderDateMs(b.part.orderDate);
      // Newest first; missing dates last
      if (ta === null && tb === null) return 0;
      if (ta === null) return 1;
      if (tb === null) return -1;
      return tb - ta;
    });
  }

  private orderDateMs(value: string | Date | null | undefined): number | null {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value);
    const ms = d.getTime();
    return Number.isNaN(ms) ? null : ms;
  }

  private collectFileResult(
    file: ParseOrderPdfFileResult,
    drafts: ImportDraft[],
    summaries: string[],
    errors: string[]
  ): void {
    if (!file.ok) {
      errors.push(`${file.fileName}: ${file.error || 'Parse failed'}`);
      summaries.push(`${file.fileName}: failed`);
      return;
    }
    const count = file.drafts?.length ?? 0;
    summaries.push(`${file.fileName}: ${count} line${count === 1 ? '' : 's'}`);
    for (const raw of file.drafts ?? []) {
      drafts.push(this.toDraft(raw));
    }
  }

  private toDraft(d: ParsedPartDraft): ImportDraft {
    const sellers = this.lookups?.sellers ?? [];
    const conditions = this.lookups?.conditions ?? [];
    const locations = this.lookups?.locations ?? [];
    const seller = sellers.includes('eBay') ? 'eBay' : (d.seller || 'eBay');
    const condition = conditions.includes('Used') ? 'Used' : (d.condition || 'Used');
    const inferredLocation = d.location?.trim() || null;
    const location = inferredLocation && (locations.length === 0 || locations.includes(inferredLocation))
      ? inferredLocation
      : null;

    const types = this.lookups?.types?.map(t => t.type) ?? [];
    const inferredType = d.type?.trim() || '';
    const type = inferredType && (types.length === 0 || types.includes(inferredType))
      ? inferredType
      : undefined;

    return {
      key: `d${++this.draftSeq}`,
      selected: !d.isDuplicate,
      isDuplicate: !!d.isDuplicate,
      quantity: d.quantity && d.quantity > 0 ? d.quantity : 1,
      sourceFileName: d.sourceFileName || '',
      imageDataUrl: d.imageDataUrl || null,
      part: {
        type,
        manufacturer: d.manufacturer ?? null,
        modelNumber: d.modelNumber ?? null,
        cost: d.cost ?? null,
        orderDate: d.orderDate ?? null,
        orderUrl: d.orderUrl ?? null,
        seller,
        condition,
        location,
        color: d.color?.trim() || null,
        merchant: d.merchant?.trim() || null,
        notes: d.notes?.trim() || null,
        hasRgb: false,
        received: false,
        bad: null,
        scam: null,
        lost: null
      }
    };
  }

  removeDraft(index: number): void {
    this.drafts.splice(index, 1);
    if (!this.drafts.length) {
      this.reset();
    }
  }

  editDraft(index: number): void {
    if (!this.lookups) return;
    const draft = this.drafts[index];
    const partForDialog: Part = {
      id: 0,
      type: draft.part.type || '',
      manufacturer: draft.part.manufacturer ?? null,
      modelNumber: draft.part.modelNumber ?? null,
      cost: draft.part.cost ?? null,
      orderDate: this.toDialogDate(draft.part.orderDate) as any,
      orderUrl: draft.part.orderUrl ?? null,
      seller: draft.part.seller ?? null,
      color: draft.part.color ?? null,
      hasRgb: !!draft.part.hasRgb,
      cpuSocket: draft.part.cpuSocket ?? null,
      pcieGen: draft.part.pcieGen ?? null,
      ramType: draft.part.ramType ?? null,
      location: draft.part.location ?? null,
      received: !!draft.part.received,
      testedDate: null,
      testedUserId: null,
      condition: draft.part.condition ?? null,
      returnByDate: this.toDialogDate(draft.part.returnByDate) as any,
      merchant: draft.part.merchant ?? null,
      notes: draft.part.notes ?? null,
      bad: draft.part.bad ?? null,
      scam: draft.part.scam ?? null,
      lost: draft.part.lost ?? null,
      computerId: null
    };

    const ref = this.dialog.open(PartDialogComponent, {
      data: {
        part: partForDialog,
        lookups: this.lookups,
        title: 'Edit imported part',
        allowSplit: false,
        previewImageUrl: draft.imageDataUrl
      },
      maxHeight: '96vh'
    });

    ref.afterClosed().subscribe((result: Partial<Part> | undefined) => {
      if (!result) return;
      const { id: _id, ...rest } = result as Part & { splitAfterSave?: boolean };
      if ((rest as { splitAfterSave?: boolean }).splitAfterSave) {
        delete (rest as { splitAfterSave?: boolean }).splitAfterSave;
      }
      this.drafts[index] = {
        ...draft,
        part: {
          ...draft.part,
          ...rest,
          orderDate: this.normalizeDateOut(rest.orderDate),
          returnByDate: this.normalizeDateOut(rest.returnByDate)
        }
      };
    });
  }

  private toDialogDate(value: string | Date | null | undefined): Date | null {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private normalizeDateOut(value: unknown): string | null {
    if (!value) return null;
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return null;
      const y = value.getFullYear();
      const m = String(value.getMonth() + 1).padStart(2, '0');
      const day = String(value.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
    if (typeof value === 'string') return value;
    return null;
  }

  create(): void {
    const source = this.drafts.filter(d => d.selected);
    if (!source.length || source.some(d => !d.part.type?.trim()) || this.busy) return;

    const parts = source.map(d => ({
      type: d.part.type!.trim(),
      manufacturer: d.part.manufacturer?.toString().trim() || null,
      modelNumber: d.part.modelNumber?.toString().trim() || null,
      cost: d.part.cost ?? null,
      orderDate: this.normalizeDateOut(d.part.orderDate),
      orderUrl: d.part.orderUrl?.toString().trim() || null,
      seller: d.part.seller || 'eBay',
      condition: d.part.condition || 'Used',
      color: d.part.color ?? null,
      hasRgb: !!d.part.hasRgb,
      cpuSocket: d.part.cpuSocket ?? null,
      pcieGen: d.part.pcieGen ?? null,
      ramType: d.part.ramType ?? null,
      location: d.part.location ?? null,
      received: !!d.part.received,
      merchant: d.part.merchant ?? null,
      notes: d.part.notes ?? null,
      bad: d.part.bad ?? null,
      scam: d.part.scam ?? null,
      lost: d.part.lost ?? null,
      returnByDate: this.normalizeDateOut(d.part.returnByDate),
      imageDataUrl: d.imageDataUrl || null
    }));

    this.busy = true;
    this.api.importParsedParts(parts).subscribe({
      next: created => {
        this.busy = false;
        this.snack.open(`Created ${created.length} part${created.length === 1 ? '' : 's'}`, undefined, { duration: 2500 });
        void this.router.navigate(['/parts']);
      },
      error: err => {
        this.busy = false;
        this.snack.open(err.error?.message ?? 'Import failed', 'OK');
      }
    });
  }
}
