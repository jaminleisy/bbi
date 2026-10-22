import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { Lookups, Part } from '../../models';
import { comparePartTypes, partDisplayLabel, partModelText } from '../../part-display';
import { PartDialogComponent } from './part-dialog.component';
import { SplitPartDialogComponent, SplitPartDialogResult } from './split-part-dialog.component';

@Component({
  selector: 'app-parts',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MatTableModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatCheckboxModule, MatDialogModule,
    MatSnackBarModule, MatTooltipModule, MatExpansionModule, MatSlideToggleModule,
    MatButtonToggleModule, MatProgressSpinnerModule],
  template: `
    <div class="page-container" [class.wide]="viewMode === 'grid'">
      <div class="header-row">
        <h1>Parts Inventory</h1>
        <span class="spacer"></span>
        <mat-button-toggle-group [(ngModel)]="viewMode" aria-label="View mode">
          <mat-button-toggle value="list" matTooltip="List view">
            <mat-icon>view_list</mat-icon> List
          </mat-button-toggle>
          <mat-button-toggle value="grid" matTooltip="Grid view">
            <mat-icon>grid_view</mat-icon> Grid
          </mat-button-toggle>
        </mat-button-toggle-group>
        @if (auth.canEditParts()) {
          <a mat-stroked-button routerLink="/parts/import-pdfs" style="margin-left:12px">
            <mat-icon>picture_as_pdf</mat-icon> Import PDFs
          </a>
          <button mat-flat-button color="primary" (click)="openPartDialog(null)" style="margin-left:12px">
            <mat-icon>add</mat-icon> New Part
          </button>
        }
      </div>

      <div class="filter-row">
        <mat-form-field appearance="outline" class="search-field">
          <mat-label>Search</mat-label>
          <input matInput [(ngModel)]="search" (ngModelChange)="onSearchChange()" (keyup.enter)="load()">
          @if (search) {
            <button matSuffix mat-icon-button type="button" (click)="clearSearch()" aria-label="Clear search">
              <mat-icon>close</mat-icon>
            </button>
          } @else {
            <mat-icon matIconSuffix>search</mat-icon>
          }
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Type</mat-label>
          <mat-select [(ngModel)]="filterType" (selectionChange)="load()">
            <mat-option value="">(all)</mat-option>
            @for (t of lookups?.types ?? []; track t.type) {
              <mat-option [value]="t.type">{{ t.type }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Seller</mat-label>
          <mat-select [(ngModel)]="filterSeller" (selectionChange)="load()">
            <mat-option value="">(all)</mat-option>
            @for (s of lookups?.sellers ?? []; track s) {
              <mat-option [value]="s">{{ s }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Location</mat-label>
          <mat-select [(ngModel)]="filterLocation" (selectionChange)="load()">
            <mat-option value="">(all)</mat-option>
            @for (l of lookups?.locations ?? []; track l) {
              <mat-option [value]="l">{{ l }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>CPU Socket</mat-label>
          <mat-select [(ngModel)]="filterCpuSocket" (selectionChange)="load()">
            <mat-option value="">(all)</mat-option>
            @for (s of lookups?.cpuSockets ?? []; track s) {
              <mat-option [value]="s">{{ s }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>RAM Type</mat-label>
          <mat-select [(ngModel)]="filterRamType" (selectionChange)="load()">
            <mat-option value="">(all)</mat-option>
            @for (s of lookups?.ramTypes ?? []; track s) {
              <mat-option [value]="s">{{ s }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>PCIe Gen</mat-label>
          <mat-select [(ngModel)]="filterPcieGen" (selectionChange)="load()">
            <mat-option value="">(all)</mat-option>
            @for (s of lookups?.pcieGens ?? []; track s) {
              <mat-option [value]="s">{{ s }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <button mat-stroked-button (click)="load()">Search</button>
      </div>

      <div class="filter-row">
        <mat-slide-toggle [(ngModel)]="filterNotReceived" (change)="load()">Not received only</mat-slide-toggle>
        <mat-slide-toggle [(ngModel)]="filterNeedsTesting" (change)="load()">Needs testing only</mat-slide-toggle>
        <mat-slide-toggle [(ngModel)]="showAssigned" (change)="onShowAssignedChange()">Show assigned</mat-slide-toggle>
        <mat-slide-toggle [(ngModel)]="showSold" [disabled]="!showAssigned" (change)="load()"
                          matTooltip="Include parts assigned to sold computers">Show sold</mat-slide-toggle>
        <mat-slide-toggle [(ngModel)]="showConfirmedBad" (change)="load()"
                          matTooltip="Include parts marked confirmed bad">Show confirmed bad</mat-slide-toggle>
      </div>

      @if (loading) {
        <div style="display:flex;justify-content:center;padding:48px">
          <mat-spinner></mat-spinner>
        </div>
      } @else if (viewMode === 'grid') {
        @if (gridColumns.length === 0) {
          <div style="text-align:center;padding:48px;color:#777">
            No parts found. Click "New Part" to add inventory.
          </div>
        } @else {
          <div class="grid-scroll mat-elevation-z1">
            <table class="grid-table">
              <thead>
                <tr>
                  @for (col of gridColumns; track col) {
                    <th>{{ col }} <span class="col-count">({{ partsByType.get(col)?.length || 0 }})</span></th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (row of gridRows; track $index) {
                  <tr>
                    @for (cell of row; track $index) {
                      <td>
                        @if (cell) {
                          <button type="button" class="grid-cell"
                                  [class.loc-ben]="cell.location === 'Ben'"
                                  [class.loc-josh]="cell.location === 'Josh'"
                                  (click)="onGridCellClick($event, cell)"
                                  [matTooltip]="gridCellTooltip(cell)">
                            <div class="grid-row">
                              <div class="grid-model">
                                @if (cell.bad === 1) {
                                  <mat-icon class="bad-icon possibly-bad" matTooltip="Possibly bad">warning</mat-icon>
                                } @else if (cell.bad === 2) {
                                  <mat-icon class="bad-icon confirmed-bad" matTooltip="Confirmed bad">dangerous</mat-icon>
                                }
                                {{ partModelText(cell) }}
                              </div>
                              <div class="grid-date">{{ cell.orderDate ? (cell.orderDate | date:'M/d/yy') : '' }}</div>
                            </div>
                            <div class="grid-row">
                              <div class="grid-meta">{{ gridCellMeta(cell) }}</div>
                              <div class="grid-cost">{{ cell.cost != null ? (cell.cost | currency) : '—' }}</div>
                            </div>
                          </button>
                        }
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      } @else {
        <mat-accordion multi>
          @for (group of groupedParts; track group.type) {
            <mat-expansion-panel [expanded]="isPanelExpanded(group.type)"
                                (expandedChange)="onPanelExpanded(group.type, $event)">
              <mat-expansion-panel-header>
                <mat-panel-title>
                  <strong>{{ group.type }}</strong>&nbsp;({{ group.parts.length }})
                </mat-panel-title>
                <mat-panel-description>
                  Total: {{ group.totalCost | currency }}
                </mat-panel-description>
              </mat-expansion-panel-header>

              <div class="panel-table-scroll">
              <table mat-table [dataSource]="group.parts" class="parts-table">
                <ng-container matColumnDef="manufacturer">
                  <th mat-header-cell *matHeaderCellDef (click)="sortBy('manufacturer')" class="sortable-header">
                    Manufacturer <mat-icon class="sort-icon">{{ sortIcon('manufacturer') }}</mat-icon>
                  </th>
                  <td mat-cell *matCellDef="let p">{{ p.manufacturer }}</td>
                </ng-container>

                <ng-container matColumnDef="modelNumber">
                  <th mat-header-cell *matHeaderCellDef (click)="sortBy('modelNumber')" class="sortable-header">
                    Model <mat-icon class="sort-icon">{{ sortIcon('modelNumber') }}</mat-icon>
                  </th>
                  <td mat-cell *matCellDef="let p" class="model-cell">
                    @if (p.bad === 1) {
                      <mat-icon class="bad-icon possibly-bad" matTooltip="Possibly bad">warning</mat-icon>
                    } @else if (p.bad === 2) {
                      <mat-icon class="bad-icon confirmed-bad" matTooltip="Confirmed bad">dangerous</mat-icon>
                    }
                    @if (p.orderUrl) {
                      <a [href]="p.orderUrl" target="_blank">{{ partModelText(p) }}</a>
                    } @else {
                      {{ partModelText(p) }}
                    }
                  </td>
                </ng-container>

                <ng-container matColumnDef="cost">
                  <th mat-header-cell *matHeaderCellDef (click)="sortBy('cost')" class="sortable-header">
                    Cost <mat-icon class="sort-icon">{{ sortIcon('cost') }}</mat-icon>
                  </th>
                  <td mat-cell *matCellDef="let p">{{ p.cost | currency }}</td>
                </ng-container>

                <ng-container matColumnDef="seller">
                  <th mat-header-cell *matHeaderCellDef (click)="sortBy('seller')" class="sortable-header">
                    Seller <mat-icon class="sort-icon">{{ sortIcon('seller') }}</mat-icon>
                  </th>
                  <td mat-cell *matCellDef="let p">{{ p.seller }}</td>
                </ng-container>

                <ng-container matColumnDef="orderDate">
                  <th mat-header-cell *matHeaderCellDef (click)="sortBy('orderDate')" class="sortable-header">
                    Ordered <mat-icon class="sort-icon">{{ sortIcon('orderDate') }}</mat-icon>
                  </th>
                  <td mat-cell *matCellDef="let p">{{ p.orderDate | date:'shortDate' }}</td>
                </ng-container>

                <ng-container matColumnDef="condition">
                  <th mat-header-cell *matHeaderCellDef (click)="sortBy('condition')" class="sortable-header">
                    Condition <mat-icon class="sort-icon">{{ sortIcon('condition') }}</mat-icon>
                  </th>
                  <td mat-cell *matCellDef="let p">
                    @if (auth.canEditParts()) {
                      <mat-select [ngModel]="p.condition" (selectionChange)="setCondition(p, $event.value)"
                                  style="min-width:90px" placeholder="(none)">
                        @for (c of lookups?.conditions ?? []; track c) {
                          <mat-option [value]="c">{{ c }}</mat-option>
                        }
                      </mat-select>
                    } @else {
                      {{ p.condition || '—' }}
                    }
                  </td>
                </ng-container>

                <ng-container matColumnDef="location">
                  <th mat-header-cell *matHeaderCellDef (click)="sortBy('location')" class="sortable-header">
                    Location <mat-icon class="sort-icon">{{ sortIcon('location') }}</mat-icon>
                  </th>
                  <td mat-cell *matCellDef="let p"
                      [class.loc-ben]="p.location === 'Ben'"
                      [class.loc-josh]="p.location === 'Josh'">
                    @if (auth.canEditParts()) {
                      <mat-select [ngModel]="p.location" (selectionChange)="setLocation(p, $event.value)"
                                  style="min-width:90px" placeholder="(none)">
                        @for (l of lookups?.locations ?? []; track l) {
                          <mat-option [value]="l">{{ l }}</mat-option>
                        }
                      </mat-select>
                    } @else {
                      {{ p.location || '—' }}
                    }
                  </td>
                </ng-container>

                <ng-container matColumnDef="computer">
                  <th mat-header-cell *matHeaderCellDef (click)="sortBy('computerName')" class="sortable-header">
                    Computer <mat-icon class="sort-icon">{{ sortIcon('computerName') }}</mat-icon>
                  </th>
                  <td mat-cell *matCellDef="let p">
                    @if (p.computerName) {
                      <span class="assigned-badge">{{ p.computerName }}</span>
                      @if (p.computerStatus === 'Sold') {
                        <span class="sold-badge" matTooltip="Assigned computer is sold">Sold</span>
                      }
                    } @else {
                      <span style="color:#999">—</span>
                    }
                  </td>
                </ng-container>

                <ng-container matColumnDef="received">
                  <th mat-header-cell *matHeaderCellDef (click)="sortBy('received')" class="sortable-header">
                    Received <mat-icon class="sort-icon">{{ sortIcon('received') }}</mat-icon>
                  </th>
                  <td mat-cell *matCellDef="let p">
                    @if (auth.canEditParts()) {
                      <mat-checkbox [checked]="p.received" (change)="toggleReceived(p, $event.checked)"></mat-checkbox>
                    } @else {
                      {{ p.received ? '✔' : '✘' }}
                    }
                  </td>
                </ng-container>

                <ng-container matColumnDef="tested">
                  <th mat-header-cell *matHeaderCellDef (click)="sortBy('testedDate')" class="sortable-header">
                    Tested <mat-icon class="sort-icon">{{ sortIcon('testedDate') }}</mat-icon>
                  </th>
                  <td mat-cell *matCellDef="let p">
                    @if (p.condition === 'Used') {
                      @if (auth.canEditParts()) {
                        <mat-checkbox [checked]="!!p.testedDate" (change)="toggleTested(p, $event.checked)"
                          [matTooltip]="p.testedDate ? ('Tested ' + (p.testedDate | date:'shortDate') + ' by ' + p.testedUserId) : 'Mark as tested'">
                        </mat-checkbox>
                      } @else {
                        {{ p.testedDate ? '✔' : '✘' }}
                      }
                    } @else {
                      <span style="color:#999" matTooltip="Only used parts need testing">n/a</span>
                    }
                  </td>
                </ng-container>

                <ng-container matColumnDef="notes">
                  <th mat-header-cell *matHeaderCellDef (click)="sortBy('notes')" class="sortable-header">
                    Notes <mat-icon class="sort-icon">{{ sortIcon('notes') }}</mat-icon>
                  </th>
                  <td mat-cell *matCellDef="let p">
                    @if (p.notes) {
                      <mat-icon style="color:#666;cursor:help" [matTooltip]="p.notes">sticky_note_2</mat-icon>
                    }
                  </td>
                </ng-container>

                <ng-container matColumnDef="actions">
                  <th mat-header-cell *matHeaderCellDef></th>
                  <td mat-cell *matCellDef="let p">
                    <button mat-icon-button matTooltip="Edit" (click)="openPartDialog(p)">
                      <mat-icon>edit</mat-icon>
                    </button>
                    <button mat-icon-button matTooltip="Split bulk purchase" [disabled]="p.cost == null"
                            (click)="openSplitPart(p)">
                      <mat-icon>call_split</mat-icon>
                    </button>
                    <button mat-icon-button matTooltip="Delete" (click)="deletePart(p)">
                      <mat-icon>delete</mat-icon>
                    </button>
                  </td>
                </ng-container>

                <tr mat-header-row *matHeaderRowDef="displayColumns"></tr>
                <tr mat-row *matRowDef="let row; columns: displayColumns;"
                    [class.not-received-row]="!row.received"></tr>
              </table>
              </div>
            </mat-expansion-panel>
          }
        </mat-accordion>

        @if (groupedParts.length === 0) {
          <div style="text-align:center;padding:48px;color:#777">
            No parts found. Click "New Part" to add inventory.
          </div>
        }
      }

      @if (!loading && parts.length > 0) {
        <div class="parts-total-summary">
          Total: {{ shownTotalCost | currency }}
        </div>
      }
    </div>
  `,
  styles: [`
    .page-container.wide { max-width: none; }
    .parts-total-summary {
      margin-top: 16px;
      padding: 12px 16px;
      background: #f5f5f5;
      border-radius: 4px;
      font-size: 15px;
      font-weight: 600;
      text-align: right;
    }
    .header-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    .filter-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
    .search-field { flex: 1 1 200px; min-width: 0; max-width: 100%; }
    .parts-table { width: 100%; min-width: 700px; }
    .panel-table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    @media (max-width: 599px) {
      .header-row {
        margin-bottom: 16px;
        row-gap: 12px;
      }
      .header-row mat-button-toggle-group {
        order: 3;
        width: 100%;
        margin-top: 4px;
      }
      .grid-scroll { max-height: calc(100vh - 320px); }
    }
    .not-received-row { background: #fff8e1; }
    .assigned-badge {
      font-size: 11px; background: #ede7f6; color: #4527a0; border-radius: 10px; padding: 2px 8px;
    }
    .sold-badge {
      font-size: 11px;
      background: #c8e6c9;
      color: #256029;
      border-radius: 10px;
      padding: 2px 8px;
      margin-left: 6px;
    }
    mat-expansion-panel { margin-bottom: 8px; }
    .sortable-header {
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
    }
    .sortable-header:hover { color: #1565c0; }
    .sort-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      vertical-align: middle;
      opacity: 0.55;
    }
    .loc-ben {
      background: #c8e6c9 !important;
    }
    .loc-josh {
      background: #bbdefb !important;
    }
    .grid-scroll {
      overflow: auto;
      background: #fff;
      border-radius: 4px;
      max-height: calc(100vh - 260px);
    }
    .grid-table {
      border-collapse: separate;
      border-spacing: 6px;
      width: max-content;
      min-width: 100%;
    }
    .grid-table th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: #f5f5f5;
      padding: 8px 10px;
      text-align: left;
      font-weight: 600;
      white-space: nowrap;
      border-bottom: 1px solid #ddd;
    }
    .col-count { font-weight: normal; color: #777; font-size: 12px; }
    .grid-table td {
      vertical-align: top;
      padding: 0;
      min-width: 140px;
      max-width: 180px;
    }
    .grid-cell {
      display: block;
      width: 100%;
      text-align: left;
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      padding: 8px 10px;
      background: #fafafa;
      cursor: pointer;
      font: inherit;
      line-height: 1.25;
    }
    .grid-cell:hover {
      outline: 2px solid #90caf9;
      outline-offset: 0;
    }
    .grid-cell.loc-ben { background: #c8e6c9; border-color: #a5d6a7; }
    .grid-cell.loc-josh { background: #bbdefb; border-color: #90caf9; }
    .grid-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 8px;
    }
    .grid-row + .grid-row { margin-top: 2px; }
    .grid-model {
      flex: 1;
      min-width: 0;
      font-weight: 600;
      font-size: 12px;
      word-break: break-word;
      display: flex;
      align-items: flex-start;
      gap: 2px;
    }
    .model-cell {
      white-space: nowrap;
    }
    .model-cell .bad-icon {
      vertical-align: middle;
      margin-right: 2px;
    }
    .bad-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      flex-shrink: 0;
    }
    .bad-icon.possibly-bad { color: #f9a825; }
    .bad-icon.confirmed-bad { color: #c62828; }
    .grid-date {
      flex-shrink: 0;
      font-size: 11px;
      color: #555;
      text-align: right;
      white-space: nowrap;
    }
    .grid-meta {
      flex: 1;
      min-width: 0;
      font-size: 12px;
      word-break: break-word;
    }
    .grid-cost {
      flex-shrink: 0;
      font-size: 12px;
      color: #333;
      text-align: right;
      white-space: nowrap;
    }
  `]
})
export class PartsComponent implements OnInit {
  columns = ['manufacturer', 'modelNumber', 'cost', 'seller', 'orderDate', 'condition', 'location', 'computer', 'received', 'tested', 'notes', 'actions'];

  parts: Part[] = [];
  lookups: Lookups | null = null;
  loading = true;
  viewMode: 'list' | 'grid' = 'list';
  /** Per-type expansion in list view; reset on each load/search. */
  private panelExpanded = new Map<string, boolean>();

  search = '';
  filterType = '';
  filterSeller = '';
  filterLocation = '';
  filterCpuSocket = '';
  filterRamType = '';
  filterPcieGen = '';
  filterNotReceived = false;
  filterNeedsTesting = false;
  /** When false (default), only unassigned parts are loaded. */
  showAssigned = false;
  /** When showAssigned is on: include parts on Sold computers. Default off. */
  showSold = false;
  /** When false (default), confirmed-bad parts (Bad = 2) are excluded. */
  showConfirmedBad = false;

  sortColumn: string | null = 'orderDate';
  sortDir: 'asc' | 'desc' = 'desc';

  /** Cached grid layout — rebuilt in rebuildGrid(), not on every change-detection pass. */
  partsByType = new Map<string, Part[]>();
  gridColumns: string[] = [];
  gridRows: (Part | null)[][] = [];

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private api: ApiService,
    private dialog: MatDialog,
    private snack: MatSnackBar,
    public auth: AuthService
  ) {}

  get displayColumns(): string[] {
    return this.auth.canEditParts()
      ? this.columns
      : this.columns.filter(c => c !== 'actions');
  }

  ngOnInit(): void {
    this.api.getLookups().subscribe(l => {
      this.lookups = l;
      this.rebuildGrid();
    });
    this.load();
  }

  onSearchChange(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.load(), 250);
  }

  clearSearch(): void {
    this.search = '';
    this.onSearchChange();
  }

  onShowAssignedChange(): void {
    if (!this.showAssigned) this.showSold = false;
    this.load();
  }

  load(): void {
    this.loading = true;
    this.api.getParts({
      search: this.search || undefined,
      type: this.filterType || undefined,
      seller: this.filterSeller || undefined,
      location: this.filterLocation || undefined,
      cpuSocket: this.filterCpuSocket || undefined,
      ramType: this.filterRamType || undefined,
      pcieGen: this.filterPcieGen || undefined,
      notReceived: this.filterNotReceived || undefined,
      needsTesting: this.filterNeedsTesting || undefined,
      unassigned: this.showAssigned ? undefined : true,
      // Only relevant when assigned parts are included.
      excludeSold: this.showAssigned && !this.showSold ? true : undefined,
      excludeConfirmedBad: this.showConfirmedBad ? undefined : true
    }).subscribe({
      next: parts => {
        this.parts = parts;
        this.resetListExpansion();
        this.rebuildGrid();
        this.loading = false;
      },
      error: () => this.loading = false
    });
  }

  /** Expand only when a single part type is in the result; otherwise collapse all. */
  private resetListExpansion(): void {
    const types = [...new Set(this.parts.map(p => p.type))];
    this.panelExpanded.clear();
    const expand = types.length === 1;
    for (const t of types) this.panelExpanded.set(t, expand);
  }

  isPanelExpanded(type: string): boolean {
    return this.panelExpanded.get(type) ?? false;
  }

  onPanelExpanded(type: string, expanded: boolean): void {
    this.panelExpanded.set(type, expanded);
  }

  private rebuildGrid(): void {
    const map = new Map<string, Part[]>();
    for (const p of this.parts) {
      if (!map.has(p.type)) map.set(p.type, []);
      map.get(p.type)!.push(p);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const aTime = a.orderDate ? Date.parse(a.orderDate) : Number.NEGATIVE_INFINITY;
        const bTime = b.orderDate ? Date.parse(b.orderDate) : Number.NEGATIVE_INFINITY;
        // Newest first; parts with no order date sink to the bottom.
        if (aTime !== bTime) return bTime - aTime;
        return (a.id ?? 0) - (b.id ?? 0);
      });
    }
    this.partsByType = map;

    const lookupOrder = (this.lookups?.types ?? []).map(t => t.type);
    const ordered = lookupOrder.filter(t => map.has(t));
    const extras = [...map.keys()].filter(t => !lookupOrder.includes(t)).sort();
    this.gridColumns = [...ordered, ...extras];

    if (!this.gridColumns.length) {
      this.gridRows = [];
      return;
    }
    const max = Math.max(...this.gridColumns.map(c => map.get(c)?.length ?? 0), 0);
    const rows: (Part | null)[][] = [];
    for (let i = 0; i < max; i++) {
      rows.push(this.gridColumns.map(c => map.get(c)?.[i] ?? null));
    }
    this.gridRows = rows;
  }

  partModelText = partModelText;

  gridCellTooltip(part: Part): string {
    const label = partDisplayLabel(part, '');
    if (part.bad === 2) return `${label} — Confirmed bad`;
    if (part.bad === 1) return `${label} — Possibly bad`;
    return label;
  }

  gridCellMeta(part: Part): string {
    return [part.manufacturer, part.seller]
      .filter((v): v is string => !!v && v !== 'null')
      .join(' · ') || '—';
  }

  onGridCellClick(event: MouseEvent, part: Part): void {
    if (event.ctrlKey) {
      event.preventDefault();
      if (part.orderUrl) {
        window.open(part.orderUrl, '_blank', 'noopener');
      } else {
        this.snack.open('No URL', undefined, { duration: 2000 });
      }
      return;
    }
    if (!this.auth.canEditParts()) return;
    this.openPartDialog(part);
  }

  sortBy(column: string): void {
    if (this.sortColumn === column) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      // Dates default to newest-first; other columns start ascending.
      this.sortDir = column === 'orderDate' || column === 'testedDate' ? 'desc' : 'asc';
    }
  }

  sortIcon(column: string): string {
    if (this.sortColumn !== column) return 'unfold_more';
    return this.sortDir === 'asc' ? 'arrow_upward' : 'arrow_downward';
  }

  private sortValue(part: Part, column: string): string | number | boolean {
    switch (column) {
      case 'manufacturer': return (part.manufacturer ?? '').toLowerCase();
      case 'modelNumber': return (part.modelNumber ?? '').toLowerCase();
      case 'cost': return part.cost ?? Number.NEGATIVE_INFINITY;
      case 'seller': return (part.seller ?? '').toLowerCase();
      case 'orderDate': return part.orderDate ? Date.parse(part.orderDate) : Number.NEGATIVE_INFINITY;
      case 'condition': return (part.condition ?? '').toLowerCase();
      case 'location': return (part.location ?? '').toLowerCase();
      case 'computerName': return (part.computerName ?? '').toLowerCase();
      case 'received': return part.received ? 1 : 0;
      case 'testedDate': return part.testedDate ? Date.parse(part.testedDate) : Number.NEGATIVE_INFINITY;
      case 'notes': return (part.notes ?? '').toLowerCase();
      default: return '';
    }
  }

  get shownTotalCost(): number {
    return this.parts.reduce((sum, p) => sum + (p.cost ?? 0), 0);
  }

  get groupedParts(): { type: string; parts: Part[]; totalCost: number }[] {
    const groups = new Map<string, Part[]>();
    for (const p of this.parts) {
      if (!groups.has(p.type)) groups.set(p.type, []);
      groups.get(p.type)!.push(p);
    }
    return [...groups.entries()]
      .sort((a, b) => comparePartTypes(a[0], b[0]))
      .map(([type, parts]) => {
        const col = this.sortColumn ?? 'orderDate';
        const dir = (this.sortDir === 'asc' ? 1 : -1);
        const sorted = [...parts].sort((a, b) => {
          const av = this.sortValue(a, col);
          const bv = this.sortValue(b, col);
          if (av < bv) return -1 * dir;
          if (av > bv) return 1 * dir;
          // Stable tie-break: newer / higher id last for asc, first for desc on orderDate default.
          return ((a.id ?? 0) - (b.id ?? 0)) * dir;
        });
        return {
          type,
          parts: sorted,
          totalCost: parts.reduce((sum, p) => sum + (p.cost ?? 0), 0)
        };
      });
  }

  openPartDialog(part: Part | null): void {
    if (!this.lookups) return;
    const isNew = part == null || part.id == null || part.id === 0;
    const ref = this.dialog.open(PartDialogComponent, {
      data: {
        part,
        lookups: this.lookups,
        allowCreateAnother: isNew
      },
      maxHeight: '96vh'
    });
    ref.afterClosed().subscribe(result => {
      if (!result) return;
      if (result.splitAfterSave) {
        const { splitAfterSave: _, ...part } = result;
        const req = part.id
          ? this.api.updatePart(part.id, part)
          : this.api.createPart(part);
        req.subscribe({
          next: saved => {
            this.applySavedPart(saved);
            this.openSplitPart(saved);
          },
          error: err => this.snack.open(err.error?.message ?? 'Save failed', 'OK')
        });
        return;
      }
      const createAnother = !!result.createAnother;
      const { createAnother: _ca, splitAfterSave: _sa, ...payload } = result;
      const req = payload.id
        ? this.api.updatePart(payload.id, payload)
        : this.api.createPart(payload);
      req.subscribe({
        next: saved => {
          this.snack.open('Part saved', undefined, { duration: 2000 });
          this.applySavedPart(saved);
          if (createAnother) {
            this.openPartDialog(this.clonePartForCreateAnother(saved));
          }
        },
        error: err => this.snack.open(err.error?.message ?? 'Save failed', 'OK')
      });
    });
  }

  /** Copy saved fields into a new-part template (no id / computer assignment). */
  private clonePartForCreateAnother(saved: Part): Part {
    const {
      id: _id,
      computerId: _cid,
      computerName: _cname,
      computerStatus: _cstatus,
      ...rest
    } = saved;
    return { ...rest, id: 0 } as Part;
  }

  openSplitPart(part: Part): void {
    if (part.cost == null) {
      this.snack.open('Part must have a cost before it can be split.', 'OK');
      return;
    }
    const ref = this.dialog.open(SplitPartDialogComponent, {
      data: { part },
      width: '360px'
    });
    ref.afterClosed().subscribe((result: SplitPartDialogResult | undefined) => {
      if (!result) return;
      this.api.splitPart(part.id, result.quantity, result.modelNumber).subscribe({
        next: () => {
          this.snack.open(`Split into ${result.quantity} parts`, undefined, { duration: 2500 });
          this.load();
        },
        error: err => this.snack.open(err.error?.message ?? 'Split failed', 'OK')
      });
    });
  }

  deletePart(part: Part): void {
    if (part.computerId) {
      this.snack.open('This part is assigned to a computer. Remove it from the computer first.', 'OK');
      return;
    }
    if (!confirm(`Delete ${partDisplayLabel(part)}?`)) return;
    this.api.deletePart(part.id).subscribe({
      next: () => {
        this.snack.open('Part deleted', undefined, { duration: 2000 });
        this.removePartLocal(part.id);
      },
      error: err => this.snack.open(err.error?.message ?? 'Delete failed', 'OK')
    });
  }

  toggleReceived(part: Part, received: boolean): void {
    this.api.markReceived(part.id, received).subscribe(() => part.received = received);
  }

  toggleTested(part: Part, tested: boolean): void {
    this.api.markTested(part.id, tested).subscribe({
      next: res => {
        part.testedDate = res.testedDate;
        part.testedUserId = res.testedUserId;
      },
      error: err => this.snack.open(err.error?.message ?? 'Failed to update tested', 'OK')
    });
  }

  /** Merge one saved part into the in-memory list without a full reload. */
  private applySavedPart(saved: Part): void {
    // Respect the confirmed-bad filter without a full reload.
    if (!this.showConfirmedBad && saved.bad === 2) {
      this.removePartLocal(saved.id);
      return;
    }
    const idx = this.parts.findIndex(p => p.id === saved.id);
    if (idx >= 0) {
      const prev = this.parts[idx];
      // API entity payload has no computerName/status — keep list-only fields.
      Object.assign(prev, saved, {
        computerName: prev.computerName ?? saved.computerName ?? null,
        computerStatus: prev.computerStatus ?? saved.computerStatus ?? null,
        computerId: saved.computerId ?? prev.computerId ?? null
      });
    } else {
      this.parts = [...this.parts, saved];
    }
    this.rebuildGrid();
  }

  private removePartLocal(id: number): void {
    this.parts = this.parts.filter(p => p.id !== id);
    this.rebuildGrid();
  }

  setLocation(part: Part, location: string): void {
    this.api.setPartLocation(part.id, location).subscribe(() => part.location = location);
  }

  setCondition(part: Part, condition: string): void {
    this.api.setPartCondition(part.id, condition).subscribe({
      next: () => {
        part.condition = condition;
        // Used parts show the tested checkbox; refresh so that UI updates immediately.
      },
      error: err => this.snack.open(err.error?.message ?? 'Failed to update condition', 'OK')
    });
  }
}
