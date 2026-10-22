import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ApiService } from '../../services/api.service';
import { computerDisplayName, partDisplayLabel, groupIdenticalParts, partQtyLabel, GroupedPart } from '../../part-display';
import { BuildSummary, BuildPartSummary } from '../../models';

@Component({
  selector: 'app-builds',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MatButtonModule, MatIconModule,
    MatProgressSpinnerModule, MatFormFieldModule, MatSelectModule, MatTooltipModule],
  template: `
    <div class="page-container">
      <div class="header-row">
        <h1>Builds</h1>
        <span class="spacer"></span>
        @if (showBuilderFilter) {
          <mat-form-field appearance="outline" class="builder-filter">
            <mat-label>Builder</mat-label>
            <mat-select [(ngModel)]="filterBuilderId">
              <mat-option value="">(all)</mat-option>
              @for (opt of builderOptions; track opt.id) {
                <mat-option [value]="opt.id">{{ opt.label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        }
      </div>

      @if (loading) {
        <div class="center">
          <mat-spinner></mat-spinner>
        </div>
      } @else if (builds.length === 0) {
        <div class="empty">
          No builds available for your account. Ask an admin to set your BuildAccess
          to the builder names you should see.
        </div>
      } @else if (filteredBuilds.length === 0) {
        <div class="empty">No builds for this builder.</div>
      } @else {
        <div class="builds-grid">
          @for (b of filteredBuilds; track b.id) {
            <a class="build-card" [routerLink]="['/builds', b.id]">
              <header class="card-header">
                <h2 class="card-title">
                  @if (hasUnreceivedParts(b)) {
                    <mat-icon class="await-icon"
                              matTooltip="One or more parts have not arrived">schedule</mat-icon>
                  }
                  @if (hasWrongLocationParts(b)) {
                    <mat-icon class="loc-warn"
                              [matTooltip]="wrongLocationTooltip(b)">warning</mat-icon>
                  }
                  {{ computerDisplayName(b) }}
                </h2>
                <div class="card-meta">
                  <span class="status-badge status-{{ statusClass(b.status) }}">{{ b.status }}</span>
                  <span class="builder">
                    <mat-icon>person</mat-icon>
                    {{ b.builderName || b.builderUserId || '—' }}
                  </span>
                </div>
              </header>
              <div class="card-body">
                @if (b.parts?.length || b.placeholders?.length) {
                  <ul class="parts-list">
                    @for (g of groupedParts(b); track g.sample.id) {
                      <li>
                        <span class="part-type">
                          @if (g.count > 1) {
                            <span class="part-qty">{{ partQtyLabel(g.count) }}</span>
                          }
                          {{ g.sample.type }}
                        </span>
                        <span class="part-label">
                          {{ partLabel(g.sample) }}
                          @if (groupHasUnreceived(g)) {
                            <mat-icon class="part-await-icon"
                                      matTooltip="Not yet received">schedule</mat-icon>
                          }
                          @if (groupHasWrongLocation(b, g)) {
                            <mat-icon class="part-loc-warn"
                                      [matTooltip]="wrongPartLocationTooltip(g)">warning</mat-icon>
                          }
                        </span>
                      </li>
                    }
                    @for (ph of b.placeholders ?? []; track ph.id) {
                      <li class="planned">
                        <span class="part-type">{{ ph.type }}</span>
                        <span class="part-label">
                          <em>{{ ph.description }}</em>
                          <span class="planned-badge">Planned</span>
                        </span>
                      </li>
                    }
                  </ul>
                } @else {
                  <div class="muted">No parts assigned</div>
                }
              </div>
              @if (hasCardFooter(b)) {
                <footer class="card-footer">
                  @if (b.computerNotes?.trim()) {
                    <div class="footer-block">
                      <div class="footer-label">Notes</div>
                      <div class="footer-text">{{ b.computerNotes }}</div>
                    </div>
                  }
                  @if ((b.comments ?? []).length) {
                    <div class="footer-block">
                      <div class="footer-label">Comments</div>
                      <ul class="comment-list">
                        @for (n of b.comments ?? []; track n.id) {
                          <li>
                            <span class="comment-meta">{{ n.userName }} · {{ n.createdDate | date:'shortDate' }}</span>
                            <span class="comment-text">{{ n.text }}</span>
                          </li>
                        }
                      </ul>
                    </div>
                  }
                </footer>
              }
            </a>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .header-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .header-row h1 { margin: 0; }
    .spacer { flex: 1; }
    .builder-filter { width: 200px; }
    .center { display: flex; justify-content: center; padding: 48px; }
    .empty {
      text-align: center;
      padding: 48px;
      color: #777;
      max-width: 480px;
      margin: 0 auto;
    }

    .builds-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
    }
    @media (min-width: 700px) {
      .builds-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    }
    @media (min-width: 1100px) {
      .builds-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }

    .build-card {
      display: flex;
      flex-direction: column;
      min-width: 0;
      background: #fff;
      border: 1px solid #e0e0e0;
      border-radius: 10px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
      text-decoration: none;
      color: inherit;
      overflow: hidden;
      transition: border-color 120ms ease, box-shadow 120ms ease;
    }
    .build-card:hover {
      border-color: #90caf9;
      box-shadow: 0 2px 8px rgba(21, 101, 192, 0.12);
    }

    .card-header {
      padding: 12px 14px;
      border-bottom: 1px solid #eee;
      background: #fafafa;
    }
    .card-title {
      margin: 0 0 8px;
      font-size: 16px;
      font-weight: 600;
      line-height: 1.3;
      color: #1565c0;
      word-break: break-word;
      display: flex;
      align-items: flex-start;
      gap: 6px;
    }
    .loc-warn {
      flex-shrink: 0;
      font-size: 18px;
      width: 18px;
      height: 18px;
      margin-top: 1px;
      color: #f9a825;
    }
    .await-icon {
      flex-shrink: 0;
      font-size: 18px;
      width: 18px;
      height: 18px;
      margin-top: 1px;
      color: #1976d2;
    }
    .card-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
    }
    .builder {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 13px;
      color: #555;
      min-width: 0;
    }
    .builder mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: #888;
    }

    .card-body {
      padding: 12px 14px 14px;
      flex: 1;
    }
    .parts-list {
      list-style: none;
      margin: 0;
      padding: 0;
      font-size: 13px;
      line-height: 1.4;
    }
    .parts-list li {
      display: grid;
      grid-template-columns: 72px 1fr;
      gap: 8px;
      padding: 5px 0;
      border-bottom: 1px solid #f3f3f3;
    }
    .parts-list li:last-child { border-bottom: none; }
    .part-type {
      color: #777;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.02em;
      padding-top: 1px;
    }
    .part-qty {
      color: #1565c0;
      font-weight: 700;
      margin-right: 2px;
      text-transform: none;
      letter-spacing: 0;
    }
    .part-label {
      min-width: 0;
      word-break: break-word;
      display: inline-flex;
      align-items: flex-start;
      gap: 4px;
    }
    .part-loc-warn {
      flex-shrink: 0;
      font-size: 16px;
      width: 16px;
      height: 16px;
      margin-top: 1px;
      color: #f9a825;
    }
    .part-await-icon {
      flex-shrink: 0;
      font-size: 16px;
      width: 16px;
      height: 16px;
      margin-top: 1px;
      color: #1976d2;
    }
    .parts-list li.planned .part-label { color: #555; }
    .planned-badge {
      display: inline-block;
      font-size: 10px;
      background: #fff3e0;
      color: #e65100;
      border-radius: 8px;
      padding: 0 5px;
      margin-left: 4px;
      font-style: normal;
      vertical-align: middle;
    }
    .muted { color: #999; font-size: 13px; }

    .card-footer {
      border-top: 1px solid #eee;
      padding: 10px 14px 12px;
      background: #fcfcfc;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .footer-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: #888;
      margin-bottom: 4px;
    }
    .footer-text {
      font-size: 15px;
      line-height: 1.4;
      color: #444;
      white-space: pre-wrap;
      word-break: break-word;
      display: -webkit-box;
      -webkit-line-clamp: 8;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .comment-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .comment-list li {
      display: flex;
      flex-direction: column;
      gap: 2px;
      font-size: 13px;
      line-height: 1.35;
    }
    .comment-meta {
      font-size: 11px;
      color: #888;
    }
    .comment-text {
      color: #444;
      word-break: break-word;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .status-badge {
      display: inline-block;
      font-size: 12px;
      border-radius: 10px;
      padding: 2px 10px;
      background: #eee;
      color: #555;
      white-space: nowrap;
    }
    .status-planned { background: #fff9c4; color: #827717; }
    .status-in-progress { background: #e3f2fd; color: #1565c0; }
    .status-built { background: #bbdefb; color: #0d47a1; }
    .status-active { background: #c8e6c9; color: #256029; }
    .status-sold { background: #2e7d32; color: #fff; }
    .status-returned { background: #ffcdd2; color: #b71c1c; }
    .status-needs-repair { background: #ffe0b2; color: #e65100; }
    .status-traded { background: #d1c4e9; color: #4527a0; }
    .status-personal { background: #f3e5f5; color: #6a1b9a; }
  `]
})
export class BuildsComponent implements OnInit {
  computerDisplayName = computerDisplayName;
  /** Sentinel so "(all)" and Unassigned aren't both empty-string values. */
  private static readonly UnassignedKey = '__unassigned__';

  builds: BuildSummary[] = [];
  loading = true;
  /** Empty string = all builders. */
  filterBuilderId = '';
  builderOptions: { id: string; label: string }[] = [];

  constructor(private api: ApiService) {}

  get showBuilderFilter(): boolean {
    return this.builderOptions.length > 1;
  }

  get filteredBuilds(): BuildSummary[] {
    if (!this.filterBuilderId) return this.builds;
    return this.builds.filter(b => this.builderKey(b) === this.filterBuilderId);
  }

  ngOnInit(): void {
    this.api.getBuilds().subscribe({
      next: builds => {
        this.builds = (builds ?? []).map(b => ({
          ...b,
          comments: b.comments ?? []
        }));
        this.builderOptions = this.buildBuilderOptions(this.builds);
        this.loading = false;
      },
      error: () => this.loading = false
    });
  }

  private builderKey(b: BuildSummary): string {
    return b.builderUserId?.trim() || BuildsComponent.UnassignedKey;
  }

  private buildBuilderOptions(builds: BuildSummary[]): { id: string; label: string }[] {
    const map = new Map<string, string>();
    for (const b of builds) {
      const id = this.builderKey(b);
      if (map.has(id)) continue;
      map.set(id, b.builderName || b.builderUserId || 'Unassigned');
    }
    return [...map.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  }

  hasCardFooter(b: BuildSummary): boolean {
    return !!b.computerNotes?.trim() || (b.comments?.length ?? 0) > 0;
  }

  /** True when the build has a location and at least one part is elsewhere (or unset). */
  hasWrongLocationParts(b: BuildSummary): boolean {
    const buildLoc = (b.location ?? '').trim();
    if (!buildLoc) return false;
    return (b.parts ?? []).some(p =>
      (p.location ?? '').trim().toLowerCase() !== buildLoc.toLowerCase());
  }

  hasUnreceivedParts(b: BuildSummary): boolean {
    return (b.parts ?? []).some(p => !p.received);
  }

  groupHasUnreceived(g: GroupedPart<BuildPartSummary>): boolean {
    return g.parts.some(p => !p.received);
  }

  wrongLocationTooltip(b: BuildSummary): string {
    const buildLoc = (b.location ?? '').trim() || 'the build location';
    return `One or more parts are not at ${buildLoc}`;
  }

  isWrongLocation(build: BuildSummary, partLocation: string | null | undefined): boolean {
    const buildLoc = (build.location ?? '').trim();
    if (!buildLoc) return false;
    return (partLocation ?? '').trim().toLowerCase() !== buildLoc.toLowerCase();
  }

  groupHasWrongLocation(b: BuildSummary, g: GroupedPart<BuildPartSummary>): boolean {
    return g.parts.some(p => this.isWrongLocation(b, p.location));
  }

  wrongPartLocationTooltip(g: GroupedPart<BuildPartSummary>): string {
    const locs = [...new Set(g.parts.map(p => (p.location ?? '').trim() || '(none)'))];
    if (locs.length === 1) return `Currently at ${locs[0]}`;
    return `Currently at ${locs.join(', ')}`;
  }

  statusClass(status: string): string {
    return (status || '').toLowerCase().replace(/\s+/g, '-');
  }

  partLabel(p: { manufacturer?: string | null; modelNumber?: string | null; color?: string | null }): string {
    return partDisplayLabel(p);
  }

  partQtyLabel = partQtyLabel;

  groupedParts(b: BuildSummary) {
    return groupIdenticalParts(b.parts ?? []);
  }
}
