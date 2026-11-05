import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import {
  BuildDetail, BuildPartSummary, BuildPlaceholderSummary, BuildUnassignedPart, Lookups, PartType, STATUSES, UserRef
} from '../../models';
import { computerDisplayName, groupIdenticalParts, partDisplayLabel, partQtyLabel, partTypeLabel, sortByPartType, GroupedPart } from '../../part-display';
import { PickPartDialogComponent } from './pick-part-dialog.component';
import { PartDialogComponent } from '../parts/part-dialog.component';

interface GroupPhoto {
  partId: number;
  imageId: number;
  createdDate: string;
}

@Component({
  selector: 'app-build-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatChipsModule, MatProgressSpinnerModule,
    MatSnackBarModule, MatDialogModule, MatTooltipModule],
  template: `
    <div class="page-container">
      <a mat-button routerLink="/builds" class="back">
        <mat-icon>arrow_back</mat-icon> All builds
      </a>

      @if (loading) {
        <div class="center">
          <mat-spinner></mat-spinner>
        </div>
      } @else if (!build) {
        <div class="empty">Build not found, or you do not have access.</div>
      } @else {
        <div class="header-row">
          <h1>{{ computerDisplayName(build) }}</h1>
          @if (canEdit) {
            <div class="header-edits" (click)="$event.stopPropagation()">
              <mat-form-field appearance="outline" class="header-field">
                <mat-label>Status</mat-label>
                <mat-select [ngModel]="build.status" (selectionChange)="setStatus($event.value)"
                            [disabled]="busy">
                  @for (s of statuses; track s) {
                    <mat-option [value]="s">{{ s }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline" class="header-field">
                <mat-label>Assigned to</mat-label>
                <mat-select [ngModel]="build.builderUserId" (selectionChange)="setBuilder($event.value)"
                            [disabled]="busy">
                  <mat-option [value]="null">(none)</mat-option>
                  @for (u of users; track u.id) {
                    <mat-option [value]="u.id">{{ u.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            </div>
          } @else {
            <mat-chip>{{ build.status }}</mat-chip>
            <span class="builder-readonly">
              <mat-icon>person</mat-icon>
              {{ build.builderName || build.builderUserId || 'Unassigned' }}
            </span>
          }
        </div>

        <section class="card">
          <div class="section-head">
            <h2>Parts</h2>
            @if (hasWrongLocationParts) {
              <mat-icon class="loc-warn" fontSet="material-symbols"
                        [matTooltip]="wrongLocationTooltip">trolley</mat-icon>
            }
          </div>

          <table class="parts-table">
            <thead>
              <tr>
                <th class="col-type">Type</th>
                <th class="col-part">Part</th>
                <th class="col-location">Location</th>
              </tr>
            </thead>
            <tbody>
              @for (g of orderedPartGroups; track g.sample.id) {
                <tr [class.wrong-location-row]="groupHasWrongLocation(g)">
                  <td class="col-type">
                    @if (g.count > 1) {
                      <span class="part-qty">{{ partQtyLabel(g.count) }}</span>
                    }
                    {{ typeLabel(g.sample.type) }}
                  </td>
                  <td class="col-part">
                    <div class="part-cell">
                      <div class="part-main">
                        <div class="part-name">{{ partLabel(g.sample) }}</div>
                        @if (canEdit || canEditParts) {
                          <div class="row-actions">
                            @if (canEditParts) {
                              <button mat-button type="button" class="mini-btn"
                                      (click)="editPart(g.sample)" [disabled]="busy">
                                Edit part
                              </button>
                            }
                            @if (canEdit) {
                              <button mat-button type="button" class="mini-btn"
                                      (click)="replacePartWithPart(g.sample)" [disabled]="busy">
                                Replace part
                              </button>
                              <button mat-button type="button" class="mini-btn"
                                      (click)="replacePartWithPlaceholder(g.sample)" [disabled]="busy">
                                Make planned
                              </button>
                            }
                          </div>
                        }
                      </div>
                      @if (groupPhotos(g); as photos) {
                        @if (photos.length) {
                          <button type="button" class="part-thumb"
                                  [class.open]="isPhotosOpen(g)"
                                  [attr.aria-expanded]="isPhotosOpen(g)"
                                  [attr.aria-label]="photos.length === 1 ? 'Show photo' : 'Show ' + photos.length + ' photos'"
                                  (click)="togglePhotos(g)">
                            @if (photoUrls[photos[0].imageId]; as url) {
                              <img [src]="url" alt="">
                            } @else {
                              <mat-icon>photo</mat-icon>
                            }
                            @if (photos.length > 1) {
                              <span class="thumb-count">{{ photos.length }}</span>
                            }
                          </button>
                        }
                      }
                    </div>
                  </td>
                  <td class="col-location">
                    @if (groupLocation(g)) {
                      <span class="part-location"
                            [class.part-location-wrong]="groupHasWrongLocation(g)">{{ groupLocation(g) }}</span>
                    } @else {
                      <span class="muted">—</span>
                    }
                    @if (groupHasWrongLocation(g)) {
                      <mat-icon class="loc-warn-inline" fontSet="material-symbols"
                                [matTooltip]="'Should be at ' + ((build?.location ?? '').trim() || 'build location')">trolley</mat-icon>
                    }
                  </td>
                </tr>
                @if (isPhotosOpen(g)) {
                  <tr class="photo-panel-row">
                    <td colspan="3">
                      <div class="photo-panel">
                        @for (photo of groupPhotos(g); track photo.imageId) {
                          <figure class="panel-photo">
                            <button type="button" class="panel-thumb" aria-label="View full size"
                                    [disabled]="!photoUrls[photo.imageId]"
                                    (click)="openLightbox(photo)">
                              @if (photoUrls[photo.imageId]; as url) {
                                <img [src]="url" alt="Part photo">
                              } @else if (photoFailed.has(photo.imageId)) {
                                <mat-icon>broken_image</mat-icon>
                              } @else {
                                <mat-spinner diameter="24"></mat-spinner>
                              }
                            </button>
                            <figcaption>{{ photo.createdDate | date:'MMM d, y' }}</figcaption>
                          </figure>
                        }
                      </div>
                    </td>
                  </tr>
                }
              }
              @for (ph of orderedPlaceholders; track ph.id) {
                <tr class="planned-row">
                  <td class="col-type">
                    {{ typeLabel(ph.type) }}
                    <span class="planned-badge">Planned</span>
                  </td>
                  <td class="col-part">
                    <div class="part-name"><em>{{ ph.description }}</em></div>
                    @if (canEdit) {
                      <div class="row-actions">
                        <button mat-button type="button" class="mini-btn" color="primary"
                                (click)="replacePlaceholder(ph)" [disabled]="busy">
                          Assign part
                        </button>
                        <button mat-button type="button" class="mini-btn"
                                (click)="editPlaceholder(ph)" [disabled]="busy">
                          Edit
                        </button>
                        <button mat-button type="button" class="mini-btn danger"
                                (click)="removePlaceholder(ph)" [disabled]="busy">
                          Remove
                        </button>
                      </div>
                    }
                  </td>
                  <td class="col-location"><span class="muted">—</span></td>
                </tr>
              }
              @if (!build.parts.length && !(build.placeholders?.length)) {
                <tr>
                  <td colspan="3" class="muted empty-parts">No parts assigned yet.</td>
                </tr>
              }
            </tbody>
          </table>

          @if (canEdit || build.computerNotes?.trim()) {
            <div class="computer-notes">
              <div class="notes-head">
                <h3>Notes</h3>
                @if (canEdit && !editingNotes) {
                  <button mat-button type="button" class="mini-btn" (click)="startEditNotes()"
                          [disabled]="busy">
                    Edit
                  </button>
                }
              </div>
              @if (canEdit && editingNotes) {
                <mat-form-field appearance="outline" class="notes-edit-field">
                  <mat-label>Build notes</mat-label>
                  <textarea matInput rows="4" [(ngModel)]="notesDraft" maxlength="4000"></textarea>
                </mat-form-field>
                <div class="notes-edit-actions">
                  <button mat-button type="button" (click)="cancelEditNotes()" [disabled]="savingNotes">
                    Cancel
                  </button>
                  <button mat-flat-button color="primary" type="button"
                          (click)="saveNotes()" [disabled]="savingNotes">
                    {{ savingNotes ? 'Saving…' : 'Save notes' }}
                  </button>
                </div>
              } @else if (build.computerNotes?.trim()) {
                <div class="computer-notes-text">{{ build.computerNotes }}</div>
              } @else {
                <p class="muted">No notes yet.</p>
              }
            </div>
          }

          @if (canEdit) {
            <div class="add-planned">
              <h3>Add planned part</h3>
              <div class="add-row">
                <mat-form-field appearance="outline" class="type-field">
                  <mat-label>Type</mat-label>
                  <mat-select [(ngModel)]="newType">
                    @for (t of partTypes; track t.type) {
                      <mat-option [value]="t.type">{{ t.type }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
                <mat-form-field appearance="outline" class="desc-field">
                  <mat-label>Description</mat-label>
                  <input matInput [(ngModel)]="newDescription" maxlength="200"
                         (keyup.enter)="addPlaceholder()">
                </mat-form-field>
                <button mat-flat-button color="primary"
                        [disabled]="!newType || !newDescription.trim() || busy"
                        (click)="addPlaceholder()">
                  Add planned
                </button>
              </div>
            </div>
          }
        </section>

        <section class="card">
          <h2>Comments</h2>

          @if (build.notes.length === 0) {
            <p class="muted">No comments yet.</p>
          } @else {
            <ul class="notes-list">
              @for (n of build.notes; track n.id) {
                <li>
                  <div class="note-meta">
                    <strong>{{ n.userName }}</strong>
                    <span class="note-date">{{ n.createdDate | date:'medium' }}</span>
                  </div>
                  <div class="note-text">{{ n.text }}</div>
                </li>
              }
            </ul>
          }

          <div class="add-note">
            <mat-form-field appearance="outline" class="note-field">
              <mat-label>Add a comment</mat-label>
              <textarea matInput rows="3" [(ngModel)]="noteText" maxlength="2000"></textarea>
            </mat-form-field>
            <button mat-flat-button color="primary"
                    [disabled]="!noteText.trim() || saving"
                    (click)="addNote()">
              {{ saving ? 'Saving…' : 'Add comment' }}
            </button>
          </div>
        </section>
      }
    </div>

    @if (lightboxUrl) {
      <div class="lightbox" (click)="closeLightbox()" role="dialog" aria-modal="true" aria-label="Photo">
        <button mat-icon-button type="button" class="lightbox-close" (click)="closeLightbox()" aria-label="Close">
          <mat-icon>close</mat-icon>
        </button>
        <img [src]="lightboxUrl" alt="Part photo full size" (click)="$event.stopPropagation()">
      </div>
    }
  `,
  styles: [`
    .back { margin: 0 0 8px -8px; }
    .center { display: flex; justify-content: center; padding: 48px; }
    .empty { text-align: center; padding: 48px; color: #777; }
    .header-row {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }
    .header-row h1 {
      margin: 0;
      font-size: 1.5rem;
      line-height: 1.25;
      word-break: break-word;
      flex: 1 1 200px;
      min-width: 0;
    }
    .header-edits {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 12px;
      align-items: flex-start;
    }
    .header-field {
      width: 160px;
      flex: 0 0 auto;
    }
    .builder-readonly {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: #555;
      font-size: 14px;
    }
    .builder-readonly mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: #888;
    }
    .card {
      background: #fff;
      border-radius: 10px;
      padding: 16px;
      margin-bottom: 16px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      border: 1px solid #eee;
    }
    .card h2 {
      margin: 0 0 12px;
      font-size: 18px;
      font-weight: 500;
    }
    .section-head { display: flex; align-items: center; gap: 12px; }
    .section-head .loc-warn {
      font-size: 20px;
      width: 20px;
      height: 20px;
      color: #f9a825;
    }

    .parts-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    .parts-table th,
    .parts-table td {
      text-align: left;
      padding: 12px 10px 12px 0;
      border-bottom: 1px solid #eee;
      vertical-align: top;
    }
    .parts-table tbody td {
      padding-top: 18px;
    }
    .parts-table th {
      color: #777;
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      padding-bottom: 8px;
    }
    .parts-table tbody tr:last-child td { border-bottom: none; }
    .col-type {
      width: 22%;
      max-width: 110px;
      font-size: 14px;
      font-weight: 600;
      color: #555;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .col-location {
      width: 18%;
      max-width: 100px;
      white-space: nowrap;
    }
    .part-location {
      display: inline-block;
      font-size: 11px;
      background: #e3f2fd;
      color: #1565c0;
      border-radius: 8px;
      padding: 1px 7px;
    }
    .part-location-wrong {
      background: #fff3e0;
      color: #e65100;
    }
    .wrong-location-row td { background: #fff8e1; }
    .loc-warn-inline {
      font-size: 16px;
      width: 16px;
      height: 16px;
      vertical-align: middle;
      margin-left: 4px;
      color: #f9a825;
    }
    .part-qty {
      color: #1565c0;
      font-weight: 700;
      margin-right: 4px;
      text-transform: none;
      letter-spacing: 0;
    }
    th.col-type { font-weight: 600; }
    .col-part { width: 60%; min-width: 0; }
    .part-name {
      font-size: 16px;
      line-height: 1.35;
      word-break: break-word;
      margin-bottom: 6px;
    }
    .row-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 2px 4px;
      margin: 0 -6px;
    }
    .mini-btn {
      min-width: 0;
      height: 28px;
      line-height: 28px;
      padding: 0 8px;
      font-size: 12px;
      font-weight: 500;
    }
    .mini-btn.danger { color: #c62828; }
    .empty-parts { padding: 16px 0 !important; }

    .part-cell {
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }
    .part-main { flex: 1 1 auto; min-width: 0; }
    .part-thumb {
      position: relative;
      flex: 0 0 auto;
      width: 48px;
      height: 48px;
      padding: 0;
      border: 1px solid #ddd;
      border-radius: 6px;
      overflow: visible;
      background: #f5f5f5;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #999;
    }
    .part-thumb:hover { border-color: #90caf9; }
    .part-thumb.open { border-color: #1565c0; box-shadow: 0 0 0 1px #1565c0; }
    .part-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      border-radius: 5px;
    }
    .thumb-count {
      position: absolute;
      top: -6px;
      right: -6px;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      box-sizing: border-box;
      border-radius: 9px;
      background: #1565c0;
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      line-height: 18px;
      text-align: center;
    }
    .parts-table tbody .photo-panel-row td {
      padding: 0 0 14px;
    }
    .photo-panel {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      padding: 10px;
      border-radius: 8px;
      background: #f7f9fc;
      border: 1px solid #e3e8ef;
    }
    .panel-photo { margin: 0; }
    .panel-photo figcaption {
      margin-top: 3px;
      font-size: 11px;
      color: #777;
      text-align: center;
    }
    .panel-thumb {
      width: 140px;
      height: 140px;
      padding: 0;
      border: 1px solid #ddd;
      border-radius: 6px;
      overflow: hidden;
      background: #f5f5f5;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #999;
    }
    .panel-thumb:hover:not(:disabled) { border-color: #90caf9; }
    .panel-thumb:disabled { cursor: default; }
    .panel-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .lightbox {
      position: fixed;
      inset: 0;
      z-index: 1100;
      background: rgba(0, 0, 0, 0.9);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 48px 8px 8px;
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

    .planned-row .col-type,
    .planned-row .part-name { color: #555; }
    .planned-badge {
      display: inline-block;
      font-size: 10px;
      background: #fff3e0;
      color: #e65100;
      border-radius: 8px;
      padding: 1px 6px;
      margin-left: 4px;
      font-weight: 600;
      text-transform: none;
      letter-spacing: 0;
      vertical-align: middle;
    }

    .computer-notes {
      margin-top: 16px;
      padding-top: 14px;
      border-top: 1px solid #eee;
    }
    .notes-head {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .computer-notes h3 {
      margin: 0;
      font-size: 14px;
      font-weight: 500;
      flex: 1;
    }
    .computer-notes-text {
      white-space: pre-wrap;
      line-height: 1.45;
      font-size: 16px;
      color: #444;
    }
    .notes-edit-field { width: 100%; max-width: 640px; }
    .notes-edit-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 4px;
    }
    .add-planned {
      margin-top: 16px;
      padding-top: 14px;
      border-top: 1px solid #eee;
    }
    .add-planned h3 {
      margin: 0 0 10px;
      font-size: 14px;
      font-weight: 500;
    }
    .add-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: flex-start;
    }
    .type-field { width: 140px; flex: 0 0 auto; }
    .desc-field { flex: 1 1 160px; min-width: 0; }
    .muted { color: #999; }

    .add-note {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
      margin-top: 16px;
    }
    .note-field { width: 100%; max-width: 640px; }
    .notes-list {
      list-style: none;
      margin: 0 0 8px;
      padding: 0;
    }
    .notes-list li {
      padding: 12px 0;
      border-bottom: 1px solid #eee;
    }
    .notes-list li:last-child { border-bottom: none; }
    .note-meta {
      display: flex;
      gap: 12px;
      align-items: baseline;
      margin-bottom: 4px;
      flex-wrap: wrap;
    }
    .note-date { color: #777; font-size: 13px; }
    .note-text { white-space: pre-wrap; line-height: 1.45; font-size: 16px; color: #444; }

    @media (max-width: 599px) {
      .card { padding: 12px; }
      .header-row h1 { font-size: 1.25rem; }
      .col-type { width: 28%; max-width: 96px; font-size: 13px; }
      .col-location { width: 22%; }
      .part-name { font-size: 15px; }
      .panel-thumb { width: 104px; height: 104px; }
      .type-field { width: 100%; }
      .add-row > button { width: 100%; }
    }
  `]
})
export class BuildDetailComponent implements OnInit, OnDestroy {
  computerDisplayName = computerDisplayName;
  /** Blob URLs keyed by image id. */
  photoUrls: Record<number, string> = {};
  photoFailed = new Set<number>();
  lightboxUrl: string | null = null;
  private photoRequests = new Set<number>();
  private openPhotoGroups = new Set<number>();
  private groupPhotoCache = new Map<number, GroupPhoto[]>();
  build: BuildDetail | null = null;
  loading = true;
  saving = false;
  busy = false;
  noteText = '';
  editingNotes = false;
  savingNotes = false;
  notesDraft = '';
  partTypes: PartType[] = [];
  users: UserRef[] = [];
  lookups: Lookups | null = null;
  statuses = STATUSES;
  newType = '';
  newDescription = '';
  private buildId = 0;

  get canEdit(): boolean {
    return this.auth.canEditBuilds();
  }

  get canEditParts(): boolean {
    return this.auth.canEditParts();
  }

  /** True when the build has a location and at least one part is elsewhere (or unset). */
  get hasWrongLocationParts(): boolean {
    const buildLoc = (this.build?.location ?? '').trim();
    if (!buildLoc || !this.build?.parts?.length) return false;
    return this.build.parts.some(p => this.isWrongLocation(p.location));
  }

  get wrongLocationTooltip(): string {
    const buildLoc = (this.build?.location ?? '').trim() || 'the build location';
    return `One or more parts are not at ${buildLoc}`;
  }

  isWrongLocation(partLocation: string | null | undefined): boolean {
    const buildLoc = (this.build?.location ?? '').trim();
    if (!buildLoc) return false;
    return (partLocation ?? '').trim().toLowerCase() !== buildLoc.toLowerCase();
  }

  groupHasWrongLocation(g: GroupedPart<BuildPartSummary>): boolean {
    return g.parts.some(p => this.isWrongLocation(p.location));
  }

  constructor(
    private route: ActivatedRoute,
    private api: ApiService,
    private auth: AuthService,
    private snack: MatSnackBar,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.buildId = Number(this.route.snapshot.paramMap.get('id'));
    if (this.canEdit || this.canEditParts) {
      this.api.getLookups().subscribe({
        next: l => {
          this.lookups = l;
          this.users = l.users ?? [];
        },
        error: () => { /* ignore */ }
      });
    }
    if (this.canEdit) {
      this.api.getBuildPartTypes().subscribe({
        next: types => this.partTypes = sortByPartType(types),
        error: () => { /* ignore */ }
      });
    }
    this.reload();
  }

  setStatus(status: string): void {
    if (!this.build || !this.canEdit || status === this.build.status) return;
    this.busy = true;
    this.api.setBuildStatus(this.build.id, status).subscribe({
      next: res => {
        this.build!.status = res.status;
        this.busy = false;
        this.snack.open('Status updated', undefined, { duration: 1500 });
        if (this.canEdit) this.reload();
      },
      error: err => {
        this.busy = false;
        this.snack.open(err.error?.message ?? 'Failed to update status', 'OK');
        this.reload();
      }
    });
  }

  setBuilder(builderUserId: string | null): void {
    if (!this.build || !this.canEdit) return;
    if ((builderUserId ?? null) === (this.build.builderUserId ?? null)) return;
    this.busy = true;
    this.api.setBuildBuilder(this.build.id, builderUserId).subscribe({
      next: res => {
        this.build!.builderUserId = res.builderUserId;
        this.build!.builderName = res.builderName;
        this.busy = false;
        this.snack.open('Assignment updated', undefined, { duration: 1500 });
      },
      error: err => {
        this.busy = false;
        this.snack.open(err.error?.message ?? 'Failed to update assignment', 'OK');
        this.reload();
      }
    });
  }

  startEditNotes(): void {
    if (!this.build || !this.canEdit) return;
    this.notesDraft = this.build.computerNotes ?? '';
    this.editingNotes = true;
  }

  cancelEditNotes(): void {
    this.editingNotes = false;
    this.notesDraft = '';
  }

  saveNotes(): void {
    if (!this.build || !this.canEdit) return;
    const notes = this.notesDraft.trim() || null;
    this.savingNotes = true;
    this.api.setBuildComputerNotes(this.build.id, notes).subscribe({
      next: res => {
        this.build!.computerNotes = res.computerNotes;
        this.editingNotes = false;
        this.notesDraft = '';
        this.savingNotes = false;
        this.snack.open('Notes saved', undefined, { duration: 1500 });
      },
      error: err => {
        this.savingNotes = false;
        this.snack.open(err.error?.message ?? 'Failed to save notes', 'OK');
      }
    });
  }

  reload(): void {
    this.loading = true;
    this.editingNotes = false;
    this.api.getBuild(this.buildId).subscribe({
      next: build => {
        this.build = {
          ...build,
          computerNotes: build.computerNotes ?? null,
          parts: build.parts ?? [],
          placeholders: build.placeholders ?? [],
          notes: build.notes ?? []
        };
        this.groupPhotoCache.clear();
        this.loading = false;
        for (const g of this.orderedPartGroups) {
          const photos = this.groupPhotos(g);
          const toLoad = this.isPhotosOpen(g) ? photos : photos.slice(0, 1);
          toLoad.forEach(p => this.loadPhoto(p));
        }
      },
      error: () => { this.build = null; this.loading = false; }
    });
  }

  ngOnDestroy(): void {
    for (const url of Object.values(this.photoUrls)) URL.revokeObjectURL(url);
  }

  /** Photos across every part in the group, newest first. */
  groupPhotos(g: GroupedPart<BuildPartSummary>): GroupPhoto[] {
    let photos = this.groupPhotoCache.get(g.sample.id);
    if (!photos) {
      photos = g.parts
        .flatMap(p => (p.images ?? []).map(i => ({ partId: p.id, imageId: i.id, createdDate: i.createdDate })))
        .sort((a, b) => Date.parse(b.createdDate) - Date.parse(a.createdDate));
      this.groupPhotoCache.set(g.sample.id, photos);
    }
    return photos;
  }

  isPhotosOpen(g: GroupedPart<BuildPartSummary>): boolean {
    return this.openPhotoGroups.has(g.sample.id);
  }

  togglePhotos(g: GroupedPart<BuildPartSummary>): void {
    if (this.openPhotoGroups.delete(g.sample.id)) return;
    this.openPhotoGroups.add(g.sample.id);
    this.groupPhotos(g).forEach(p => this.loadPhoto(p));
  }

  openLightbox(photo: GroupPhoto): void {
    this.lightboxUrl = this.photoUrls[photo.imageId] ?? null;
  }

  @HostListener('document:keydown.escape')
  closeLightbox(): void {
    this.lightboxUrl = null;
  }

  private loadPhoto(photo: GroupPhoto): void {
    if (this.photoUrls[photo.imageId] || this.photoRequests.has(photo.imageId)) return;
    this.photoRequests.add(photo.imageId);
    this.api.getBuildPartImage(this.buildId, photo.partId, photo.imageId).subscribe({
      next: blob => {
        this.photoRequests.delete(photo.imageId);
        this.photoFailed.delete(photo.imageId);
        this.photoUrls[photo.imageId] = URL.createObjectURL(blob);
      },
      error: () => {
        this.photoRequests.delete(photo.imageId);
        this.photoFailed.add(photo.imageId);
      }
    });
  }

  get orderedParts(): BuildPartSummary[] {
    return sortByPartType(this.build?.parts ?? []);
  }

  get orderedPartGroups() {
    return groupIdenticalParts(this.orderedParts);
  }

  groupLocation(g: GroupedPart<BuildPartSummary>): string {
    const locs = [...new Set(g.parts.map(p => (p.location ?? '').trim()))];
    if (locs.length === 0) return '';
    if (locs.length > 1) return 'Mixed';
    return locs[0] || '';
  }

  get orderedPlaceholders(): BuildPlaceholderSummary[] {
    return sortByPartType(this.build?.placeholders ?? []);
  }

  partQtyLabel = partQtyLabel;

  typeLabel(type: string): string {
    return partTypeLabel(type);
  }

  partLabel(p: BuildPartSummary): string {
    return partDisplayLabel(p);
  }

  addPlaceholder(): void {
    if (!this.canEdit || !this.build || !this.newType || !this.newDescription.trim()) return;
    this.busy = true;
    this.api.addBuildPlaceholder(this.build.id, this.newType, this.newDescription.trim()).subscribe({
      next: () => {
        this.newDescription = '';
        this.busy = false;
        this.snack.open('Planned part added', undefined, { duration: 2000 });
        this.reload();
      },
      error: err => {
        this.busy = false;
        this.snack.open(err.error?.message ?? 'Failed to add planned part', 'OK');
      }
    });
  }

  editPlaceholder(ph: BuildPlaceholderSummary): void {
    if (!this.canEdit || !this.build) return;
    const description = window.prompt('Planned part description', ph.description);
    if (description == null) return;
    const text = description.trim();
    if (!text) {
      this.snack.open('Description is required', 'OK');
      return;
    }
    this.busy = true;
    this.api.updateBuildPlaceholder(this.build.id, ph.id, ph.type, text).subscribe({
      next: () => {
        this.busy = false;
        this.reload();
      },
      error: err => {
        this.busy = false;
        this.snack.open(err.error?.message ?? 'Failed to update', 'OK');
      }
    });
  }

  removePlaceholder(ph: BuildPlaceholderSummary): void {
    if (!this.canEdit || !this.build || !confirm(`Remove planned ${ph.type}?`)) return;
    this.busy = true;
    this.api.deleteBuildPlaceholder(this.build.id, ph.id).subscribe({
      next: () => {
        this.busy = false;
        this.reload();
      },
      error: err => {
        this.busy = false;
        this.snack.open(err.error?.message ?? 'Failed to remove', 'OK');
      }
    });
  }

  replacePlaceholder(ph: BuildPlaceholderSummary): void {
    if (!this.canEdit || !this.build) return;
    this.pickPart(ph.type, `Assign inventory ${ph.type}`).subscribe(part => {
      if (!part || !this.build) return;
      this.busy = true;
      this.api.replaceBuildPlaceholder(this.build.id, ph.id, part.id).subscribe({
        next: () => {
          this.busy = false;
          this.snack.open('Part assigned', undefined, { duration: 2000 });
          this.reload();
        },
        error: err => {
          this.busy = false;
          this.snack.open(err.error?.message ?? 'Failed to assign part', 'OK');
        }
      });
    });
  }

  replacePartWithPart(p: BuildPartSummary): void {
    if (!this.canEdit || !this.build) return;
    this.pickPart(p.type, `Replace ${p.type}`).subscribe(part => {
      if (!part || !this.build) return;
      this.busy = true;
      this.api.replaceBuildPartWithPart(this.build.id, p.id, part.id).subscribe({
        next: () => {
          this.busy = false;
          this.snack.open('Part replaced', undefined, { duration: 2000 });
          this.reload();
        },
        error: err => {
          this.busy = false;
          this.snack.open(err.error?.message ?? 'Failed to replace part', 'OK');
        }
      });
    });
  }

  editPart(p: BuildPartSummary): void {
    if (!this.canEditParts || !this.lookups) return;
    this.busy = true;
    this.api.getPart(p.id).subscribe({
      next: part => {
        this.busy = false;
        const ref = this.dialog.open(PartDialogComponent, {
          data: { part, lookups: this.lookups!, allowCreateAnother: false },
          maxHeight: '96vh'
        });
        ref.afterClosed().subscribe(result => {
          if (!result?.id) return;
          const { createAnother: _ca, splitAfterSave: _sa, ...payload } = result;
          this.busy = true;
          this.api.updatePart(payload.id, payload).subscribe({
            next: () => {
              this.busy = false;
              this.snack.open('Part saved', undefined, { duration: 2000 });
              this.reload();
            },
            error: err => {
              this.busy = false;
              this.snack.open(err.error?.message ?? 'Failed to save part', 'OK');
            }
          });
        });
      },
      error: err => {
        this.busy = false;
        this.snack.open(err.error?.message ?? 'Failed to load part', 'OK');
      }
    });
  }

  replacePartWithPlaceholder(p: BuildPartSummary): void {
    if (!this.canEdit || !this.build) return;
    const defaultText = this.partLabel(p);
    const description = window.prompt('Planned description (current part returns to inventory)', defaultText);
    if (description == null) return;
    const text = description.trim();
    if (!text) {
      this.snack.open('Description is required', 'OK');
      return;
    }
    this.busy = true;
    this.api.replaceBuildPartWithPlaceholder(this.build.id, p.id, text).subscribe({
      next: () => {
        this.busy = false;
        this.snack.open('Converted to planned part', undefined, { duration: 2000 });
        this.reload();
      },
      error: err => {
        this.busy = false;
        this.snack.open(err.error?.message ?? 'Failed to convert', 'OK');
      }
    });
  }

  private pickPart(type: string, title: string): Observable<BuildUnassignedPart | undefined> {
    const ref = this.dialog.open(PickPartDialogComponent, {
      data: { type, title, computerId: this.buildId },
      width: '480px',
      maxHeight: '80vh'
    });
    return ref.afterClosed();
  }

  addNote(): void {
    if (!this.build || !this.noteText.trim()) return;
    this.saving = true;
    this.api.addBuildNote(this.build.id, this.noteText.trim()).subscribe({
      next: note => {
        this.build!.notes = [note, ...this.build!.notes];
        this.noteText = '';
        this.saving = false;
        this.snack.open('Comment added', undefined, { duration: 2000 });
      },
      error: err => {
        this.saving = false;
        this.snack.open(err.error?.message ?? 'Failed to add comment', 'OK');
      }
    });
  }
}
