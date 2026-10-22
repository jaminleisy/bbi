import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiService } from '../../services/api.service';
import { Computer, Lookups, Part, STATUSES, Wage, ComputerShare } from '../../models';
import { computerDisplayName, groupIdenticalParts, partModelText, partQtyLabel, sortByPartType, GroupedPart } from '../../part-display';
import { PartDialogComponent } from '../parts/part-dialog.component';
import { ComputerDialogComponent } from './computer-dialog.component';
import { PaymentDialogComponent } from './payment-dialog.component';
import { WageDialogComponent } from './wage-dialog.component';
import { ShareDialogComponent } from './share-dialog.component';
import { AssignPartsDialogComponent } from './assign-parts-dialog.component';
import { PriceEditDialogComponent } from './price-edit-dialog.component';
import { NewComputerPartsDialogComponent } from './new-computer-parts-dialog.component';
import { MissingPartsIconComponent } from '../../missing-parts-icon.component';

export type ComputersPageMode = 'in-progress' | 'sold';

type InProgressTab = 'all' | 'planned' | 'in-progress' | 'built' | 'needs-repair' | 'traded' | 'personal';

/** In-progress page tabs; `statuses: null` means every status not in EXCLUDED_FROM_ALL. */
const IN_PROGRESS_TABS: { key: InProgressTab; label: string; statuses: string[] | null }[] = [
  { key: 'all', label: 'All', statuses: null },
  { key: 'planned', label: 'Planned', statuses: ['Planned'] },
  { key: 'in-progress', label: 'In-Progress', statuses: ['In-progress'] },
  { key: 'built', label: 'Built', statuses: ['Built', 'Active'] },
  { key: 'needs-repair', label: 'Needs Repair', statuses: ['Needs repair'] },
  { key: 'traded', label: 'Traded', statuses: ['Traded'] },
  { key: 'personal', label: 'Personal', statuses: ['Personal'] }
];

/** Statuses that only appear on their own tab, not under All. */
const EXCLUDED_FROM_ALL = new Set(['Traded', 'Personal']);

@Component({
  selector: 'app-computers',
  standalone: true,
  imports: [CommonModule, FormsModule, MatTableModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatTabsModule,
    MatDialogModule, MatSnackBarModule, MatTooltipModule, MatChipsModule, MatProgressSpinnerModule,
    MissingPartsIconComponent],
  template: `
    <div class="page-container wide">
      <div class="header-row">
        <h1>{{ mode === 'sold' ? 'Sold Computers' : 'In-Progress Computers' }}</h1>
        <span class="spacer"></span>
        @if (mode === 'in-progress') {
          <button mat-flat-button color="primary" (click)="openNewComputer()">
            <mat-icon>add</mat-icon> New Computer
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
          <mat-label>Search by</mat-label>
          <mat-select [(ngModel)]="searchField" (selectionChange)="load()">
            <mat-option value="search">Anything</mat-option>
            <mat-option value="name">Name</mat-option>
            <mat-option value="part">Part</mat-option>
            <mat-option value="builder">Builder (user id)</mat-option>
            <mat-option value="addedUser">Added by (user id)</mat-option>
            <mat-option value="location">Location</mat-option>
            <mat-option value="customer">Customer</mat-option>
          </mat-select>
        </mat-form-field>

        <button mat-stroked-button (click)="load()">Search</button>

        <span class="spacer"></span>

        @if (mode === 'sold') {
          <mat-form-field appearance="outline" class="year-field">
            <mat-label>Year</mat-label>
            <mat-select [(ngModel)]="soldYear" (selectionChange)="load()">
              <mat-option [value]="'all'">All</mat-option>
              @for (y of soldYearOptions; track y) {
                <mat-option [value]="y">{{ y }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        }
      </div>

      @if (mode === 'in-progress') {
        <mat-tab-group class="status-tabs" animationDuration="0ms" mat-stretch-tabs="false"
                       [selectedIndex]="tabIndex" (selectedIndexChange)="selectTab($event)">
          @for (t of tabs; track t.key) {
            <mat-tab [label]="t.label + (loading ? '' : ' (' + tabCount(t.key) + ')')"></mat-tab>
          }
        </mat-tab-group>
      }

      @if (loading) {
        <div style="display:flex;justify-content:center;padding:48px">
          <mat-spinner></mat-spinner>
        </div>
      } @else {
        <div class="table-scroll">
        <table mat-table [dataSource]="sortedComputers" multiTemplateDataRows class="mat-elevation-z1 computers-table">

          <ng-container matColumnDef="primaryActions">
            <th mat-header-cell *matHeaderCellDef></th>
            <td mat-cell *matCellDef="let c" class="icon-cell primary-actions-cell"
                (click)="$event.stopPropagation()">
              <button mat-icon-button matTooltip="Edit computer"
                      (click)="openComputerDialog(c)">
                <mat-icon>edit</mat-icon>
              </button>
              <button mat-icon-button matTooltip="Record payment"
                      (click)="openPaymentDialog(c)">
                <mat-icon>attach_money</mat-icon>
              </button>
            </td>
          </ng-container>

          <ng-container matColumnDef="warning">
            <th mat-header-cell *matHeaderCellDef (click)="sortBy('warning')" class="sortable-header">
              <mat-icon class="sort-icon">{{ sortIcon('warning') }}</mat-icon>
            </th>
            <td mat-cell *matCellDef="let c" class="warn-cell">
              @if (c.missingRequiredTypes?.length && !c.ignoreIncomplete) {
                <app-missing-parts-icon
                  [matTooltip]="'Missing required parts: ' + c.missingRequiredTypes.join(', ')"></app-missing-parts-icon>
              }
              @if (c.hasWrongLocationParts) {
                <mat-icon class="loc-warn" fontSet="material-symbols"
                          [matTooltip]="c.location
                            ? 'One or more parts are not at ' + c.location
                            : 'One or more parts are not at the computer location'">trolley</mat-icon>
              }
            </td>
          </ng-container>

          <ng-container matColumnDef="name">
            <th mat-header-cell *matHeaderCellDef (click)="sortBy('name')" class="sortable-header">
              Name <mat-icon class="sort-icon">{{ sortIcon('name') }}</mat-icon>
            </th>
            <td mat-cell *matCellDef="let c" class="name-cell">
              <strong>{{ computerDisplayName(c) }}</strong>
              <span class="type-badge">{{ c.type }}</span>
            </td>
          </ng-container>

          <ng-container matColumnDef="status">
            <th mat-header-cell *matHeaderCellDef (click)="sortBy('status')" class="sortable-header">
              Status <mat-icon class="sort-icon">{{ sortIcon('status') }}</mat-icon>
            </th>
            <td mat-cell *matCellDef="let c" (click)="$event.stopPropagation()" class="inline-edit-cell status-cell">
              <mat-select [ngModel]="c.status" (selectionChange)="setStatus(c, $event.value)"
                          class="inline-select">
                @for (s of statuses; track s) {
                  <mat-option [value]="s">{{ s }}</mat-option>
                }
              </mat-select>
            </td>
          </ng-container>

          <ng-container matColumnDef="location">
            <th mat-header-cell *matHeaderCellDef (click)="sortBy('location')" class="sortable-header">
              Location <mat-icon class="sort-icon">{{ sortIcon('location') }}</mat-icon>
            </th>
            <td mat-cell *matCellDef="let c" (click)="$event.stopPropagation()" class="inline-edit-cell location-cell"
                [class.loc-ben]="c.location === 'Ben'"
                [class.loc-josh]="c.location === 'Josh'">
              <mat-select [ngModel]="c.location" (selectionChange)="setLocation(c, $event.value)"
                          class="inline-select" placeholder="(none)">
                <mat-option [value]="null">(none)</mat-option>
                @for (l of lookups?.locations ?? []; track l) {
                  <mat-option [value]="l">{{ l }}</mat-option>
                }
              </mat-select>
            </td>
          </ng-container>

          <ng-container matColumnDef="builder">
            <th mat-header-cell *matHeaderCellDef (click)="sortBy('builder')" class="sortable-header">
              Builder <mat-icon class="sort-icon">{{ sortIcon('builder') }}</mat-icon>
            </th>
            <td mat-cell *matCellDef="let c" (click)="$event.stopPropagation()" class="inline-edit-cell builder-cell">
              <mat-select [ngModel]="c.builderUserId" (selectionChange)="setBuilder(c, $event.value)"
                          class="inline-select" placeholder="(none)">
                <mat-option [value]="null">(none)</mat-option>
                @for (u of lookups?.users ?? []; track u.id) {
                  <mat-option [value]="u.id">{{ u.name }}</mat-option>
                }
              </mat-select>
            </td>
          </ng-container>

          <ng-container matColumnDef="partsCost">
            <th mat-header-cell *matHeaderCellDef (click)="sortBy('partsCost')" class="sortable-header">
              Parts Cost <mat-icon class="sort-icon">{{ sortIcon('partsCost') }}</mat-icon>
            </th>
            <td mat-cell *matCellDef="let c">{{ c.partsCost | currency }}</td>
          </ng-container>

          <ng-container matColumnDef="price">
            <th mat-header-cell *matHeaderCellDef (click)="sortBy('price')" class="sortable-header"
                matTooltip="Tax-inclusive (total customer pays)">
              Price <mat-icon class="sort-icon">{{ sortIcon('price') }}</mat-icon>
            </th>
            <td mat-cell *matCellDef="let c" (click)="openPriceEdit(c); $event.stopPropagation()" class="price-cell">
              {{ c.price != null ? (c.price | currency) : '—' }}@if (c.status !== 'Sold' && c.price != null) { <small> (est)</small> }
            </td>
          </ng-container>

          <ng-container matColumnDef="soldDate">
            <th mat-header-cell *matHeaderCellDef (click)="sortBy('soldDate')" class="sortable-header">
              Sold Date <mat-icon class="sort-icon">{{ sortIcon('soldDate') }}</mat-icon>
            </th>
            <td mat-cell *matCellDef="let c">{{ c.soldDate ? (c.soldDate | date:'M/d/yyyy') : '—' }}</td>
          </ng-container>

          <ng-container matColumnDef="tax">
            <th mat-header-cell *matHeaderCellDef (click)="sortBy('tax')" class="sortable-header">
              Taxes <mat-icon class="sort-icon">{{ sortIcon('tax') }}</mat-icon>
            </th>
            <td mat-cell *matCellDef="let c">{{ c.tax != null ? (c.tax | currency) : '—' }}</td>
          </ng-container>

          <ng-container matColumnDef="profit">
            <th mat-header-cell *matHeaderCellDef (click)="sortBy('profit')" class="sortable-header"
                matTooltip="(Price − Tax) − Parts Cost">
              Profit <mat-icon class="sort-icon">{{ sortIcon('profit') }}</mat-icon>
            </th>
            <td mat-cell *matCellDef="let c">
              <span [class.ok-text]="c.profit > 0" [class.warn-text]="c.profit < 0">
                {{ c.profit | currency }}
              </span>@if (c.status !== 'Sold') { <small> (est)</small> }
            </td>
          </ng-container>

          <ng-container matColumnDef="wages">
            <th mat-header-cell *matHeaderCellDef (click)="sortBy('wages')" class="sortable-header"
                matTooltip="Wages paid to anyone except Josh">
              Wages <mat-icon class="sort-icon">{{ sortIcon('wages') }}</mat-icon>
            </th>
            <td mat-cell *matCellDef="let c">{{ (c.wagesNonJosh || 0) | currency }}</td>
          </ng-container>

          <ng-container matColumnDef="joshShare">
            <th mat-header-cell *matHeaderCellDef (click)="sortBy('joshShare')" class="sortable-header"
                matTooltip="Josh's share percentage / Josh's wages">
              Josh Share <mat-icon class="sort-icon">{{ sortIcon('joshShare') }}</mat-icon>
            </th>
            <td mat-cell *matCellDef="let c">
              @if (c.joshSharePercentage != null) {
                {{ c.joshSharePercentage }}%
              }
              @if (c.joshSharePercentage != null && c.wagesJosh) {
                <span class="josh-sep">/</span>
              }
              @if (c.wagesJosh) {
                {{ c.wagesJosh | currency }}
              }
            </td>
          </ng-container>

          <ng-container matColumnDef="benProfit">
            <th mat-header-cell *matHeaderCellDef (click)="sortBy('benProfit')" class="sortable-header"
                matTooltip="Profit − all wages + wages paid to Ben L">
              Ben Profit <mat-icon class="sort-icon">{{ sortIcon('benProfit') }}</mat-icon>
            </th>
            <td mat-cell *matCellDef="let c">
              <span [class.ok-text]="(c.benProfit ?? 0) > 0" [class.warn-text]="(c.benProfit ?? 0) < 0">
                {{ c.benProfit | currency }}
              </span>
            </td>
          </ng-container>

          <ng-container matColumnDef="paid">
            <th mat-header-cell *matHeaderCellDef (click)="sortBy('paid')" class="sortable-header">
              Paid <mat-icon class="sort-icon">{{ sortIcon('paid') }}</mat-icon>
            </th>
            <td mat-cell *matCellDef="let c">
              @if (c.hasPayment) {
                <mat-icon class="ok-text" matTooltip="Payment received: {{ c.netPaid | currency }}">paid</mat-icon>
              } @else if (c.hasDeposit) {
                <mat-icon style="color:#f9a825" matTooltip="Deposit received: {{ c.netPaid | currency }}">savings</mat-icon>
              }
            </td>
          </ng-container>

          <ng-container matColumnDef="customer">
            <th mat-header-cell *matHeaderCellDef (click)="sortBy('customer')" class="sortable-header">
              Customer <mat-icon class="sort-icon">{{ sortIcon('customer') }}</mat-icon>
            </th>
            <td mat-cell *matCellDef="let c" class="customer-cell">
              @if (c.conversationUrl) {
                <a [href]="c.conversationUrl" target="_blank" rel="noopener"
                   matTooltip="Open conversation" (click)="$event.stopPropagation()">
                  {{ c.customerName?.trim() || 'Conversation' }}
                </a>
              } @else if (c.customerName?.trim()) {
                {{ c.customerName }}
              } @else {
                —
              }
              @if (c.isShipping) {
                <mat-icon class="ship-icon" matTooltip="Shipping{{ c.trackingNumber ? ' — ' + c.trackingNumber : '' }}">local_shipping</mat-icon>
              }
              @if (mode === 'in-progress' && hasAnyPayment(c)) {
                <mat-icon class="paid-icon" matTooltip="Paid: {{ c.netPaid | currency }}">attach_money</mat-icon>
              }
            </td>
          </ng-container>

          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef></th>
            <td mat-cell *matCellDef="let c" class="icon-cell actions-cell">
              @if (mode === 'sold') {
                <button mat-icon-button matTooltip="Invoice"
                        (click)="openInvoice(c); $event.stopPropagation()">
                  <mat-icon>receipt_long</mat-icon>
                </button>
                <button mat-icon-button matTooltip="Record payment" (click)="openPaymentDialog(c); $event.stopPropagation()">
                  <mat-icon>attach_money</mat-icon>
                </button>
                <button mat-icon-button matTooltip="Edit computer" (click)="openComputerDialog(c); $event.stopPropagation()">
                  <mat-icon>edit</mat-icon>
                </button>
              }
              @if (mode !== 'sold') {
                <button mat-icon-button matTooltip="Copy parts list"
                        (click)="copyPartsList(c); $event.stopPropagation()">
                  <mat-icon>content_copy</mat-icon>
                </button>
              }
              <button mat-icon-button matTooltip="Public link" (click)="copyPublicLink(c); $event.stopPropagation()">
                <mat-icon>share</mat-icon>
              </button>
              <button mat-icon-button matTooltip="Delete" (click)="deleteComputer(c); $event.stopPropagation()">
                <mat-icon>delete</mat-icon>
              </button>
            </td>
          </ng-container>

          <!-- Expanded detail row -->
          <ng-container matColumnDef="expandedDetail">
            <td mat-cell *matCellDef="let c" [attr.colspan]="displayedColumns.length">
              <div class="detail-wrapper" [class.open]="expandedId === c.id">
                <div class="detail-content">
                  @if (detailLoadingId === c.id) {
                    <div style="display:flex;justify-content:center;padding:24px">
                      <mat-spinner diameter="32"></mat-spinner>
                    </div>
                  } @else if (expandedId === c.id) {
                  <div class="detail-header">
                    <h3>Parts ({{ c.parts.length + (c.placeholders?.length || 0) }})</h3>
                    <button mat-stroked-button (click)="openAssignParts(c)">
                      <mat-icon>playlist_add</mat-icon> Edit Parts List
                    </button>
                  </div>
                  @if (c.missingRequiredTypes?.length && !c.ignoreIncomplete) {
                    <div class="warn-text" style="margin-bottom:8px">
                      <app-missing-parts-icon compact></app-missing-parts-icon>
                      Missing required: {{ c.missingRequiredTypes.join(', ') }}
                    </div>
                  }
                  @if (c.parts.length || c.placeholders?.length || hasBulk(c)) {
                    <table class="inner-table">
                      <tr>
                        <th class="part-edit-col"></th>
                        <th>Type</th><th>Manufacturer</th><th>Model</th><th>Cost</th>
                        <th>Condition</th><th>Location</th><th>Received</th><th>Tested</th>
                      </tr>
                      @for (g of groupedParts(c); track g.sample.id) {
                        <tr [class.wrong-location-row]="groupHasWrongLocation(c, g)">
                          <td class="part-edit-col">
                            <button mat-icon-button type="button"
                                    [matTooltip]="g.count > 1 ? 'Edit one of these parts' : 'Edit part'"
                                    (click)="openEditPart(c, g.sample); $event.stopPropagation()">
                              <mat-icon style="font-size:18px">edit</mat-icon>
                            </button>
                          </td>
                          <td>
                            @if (g.count > 1) {
                              <span class="part-qty">{{ partQtyLabel(g.count) }}</span>
                            }
                            {{ g.sample.type }}
                          </td>
                          <td>{{ g.sample.manufacturer }}</td>
                          <td>
                            @if (g.sample.orderUrl) {
                              <a [href]="g.sample.orderUrl" target="_blank" rel="noopener"
                                 (click)="$event.stopPropagation()">{{ partModelText(g.sample) }}</a>
                            } @else {
                              {{ partModelText(g.sample) }}
                            }
                          </td>
                          <td>{{ groupCost(g) | currency }}</td>
                          <td>{{ groupField(g, 'condition') }}</td>
                          <td>
                            {{ groupField(g, 'location') }}
                            @if (groupHasWrongLocation(c, g)) {
                              <mat-icon class="loc-warn-inline" fontSet="material-symbols"
                                        [matTooltip]="'Should be at ' + (c.location || 'computer location')">trolley</mat-icon>
                            }
                          </td>
                          <td>{{ groupReceived(g) }}</td>
                          <td>{{ groupTested(g) }}</td>
                        </tr>
                      }
                      @for (ph of c.placeholders ?? []; track ph.id) {
                        <tr class="planned-row">
                          <td class="part-edit-col"></td>
                          <td>{{ ph.type }} <span class="planned-badge">Planned</span></td>
                          <td colspan="2">{{ ph.description }}</td>
                          <td colspan="5" style="color:#999">Not in inventory</td>
                        </tr>
                      }
                      @if (hasBulk(c)) {
                        <tr class="bulk-row">
                          <td class="part-edit-col"></td>
                          <td>Bulk</td>
                          <td colspan="2">{{ c.bulkDesc?.trim() || '—' }}</td>
                          <td>{{ c.bulkCost != null ? (c.bulkCost | currency) : '—' }}</td>
                          <td colspan="4"></td>
                        </tr>
                      }
                    </table>
                  } @else {
                    <div style="color:#777">No parts assigned yet.</div>
                  }

                  <div class="detail-header" style="margin-top:16px">
                    <h3>Payments ({{ c.payments.length }})</h3>
                    <button mat-stroked-button (click)="openPaymentDialog(c)">
                      <mat-icon>add</mat-icon> Record Payment
                    </button>
                  </div>
                  @if (c.payments.length) {
                    <table class="inner-table">
                      <tr><th>Type</th><th>Amount</th><th>Tax</th><th>Fee</th><th>Method</th><th>Date</th><th></th></tr>
                      @for (pay of c.payments; track pay.id) {
                        <tr>
                          <td>{{ pay.type }}</td>
                          <td>{{ pay.amount | currency }}</td>
                          <td>{{ pay.tax != null ? (pay.tax | currency) : '—' }}</td>
                          <td>{{ pay.fee != null ? (pay.fee | currency) : '—' }}</td>
                          <td>{{ pay.method }}</td>
                          <td>{{ pay.date | date:'shortDate' }}</td>
                          <td>
                            <button mat-icon-button (click)="deletePayment(c, pay.id)">
                              <mat-icon style="font-size:18px">delete</mat-icon>
                            </button>
                          </td>
                        </tr>
                      }
                    </table>
                    <div style="margin-top:4px">
                      Net paid: <strong>{{ c.netPaid | currency }}</strong>
                      @if (c.price != null) {
                        / due: <strong>{{ c.price | currency }}</strong>
                      }
                    </div>
                  } @else {
                    <div style="color:#777">No payments recorded.</div>
                  }

                  <div class="detail-header" style="margin-top:16px">
                    <h3>Shares ({{ (c.shares ?? []).length }})</h3>
                    <button mat-stroked-button (click)="openShareDialog(c)">
                      <mat-icon>add</mat-icon> Add Share
                    </button>
                  </div>
                  @if ((c.shares ?? []).length) {
                    <table class="inner-table">
                      <tr><th>Builder</th><th>%</th><th>Suggested amount</th><th></th></tr>
                      @for (s of c.shares ?? []; track s.id) {
                        <tr>
                          <td>{{ s.builderName || builderLabel(s.builderUserId) }}</td>
                          <td>{{ s.percentage }}%</td>
                          <td>{{ s.amount != null ? (s.amount | currency) : '—' }}</td>
                          <td class="row-actions">
                            <button mat-icon-button matTooltip="Edit" (click)="openShareDialog(c, s)">
                              <mat-icon style="font-size:18px">edit</mat-icon>
                            </button>
                            <button mat-icon-button matTooltip="Delete" (click)="deleteShare(c, s.id)">
                              <mat-icon style="font-size:18px">delete</mat-icon>
                            </button>
                          </td>
                        </tr>
                      }
                    </table>
                    <div style="margin-top:4px">
                      Share base: <strong>{{ c.shareBase != null ? (c.shareBase | currency) : '—' }}</strong>
                      <span style="color:#777;margin-left:8px;font-size:12px">
                        (profit minus wages to non-share builders)
                      </span>
                    </div>
                  } @else {
                    <div style="color:#777">No shares defined.</div>
                  }

                  <div class="detail-header" style="margin-top:16px">
                    <h3>Wages ({{ (c.wages ?? []).length }})</h3>
                    <button mat-stroked-button (click)="openWageDialog(c)">
                      <mat-icon>add</mat-icon> Add Wage
                    </button>
                  </div>
                  @if ((c.wages ?? []).length) {
                    <table class="inner-table">
                      <tr><th>Builder</th><th>Amount</th><th>Paid</th><th>Method</th><th>Notes</th><th></th></tr>
                      @for (w of c.wages ?? []; track w.id) {
                        <tr>
                          <td>{{ builderLabel(w.builderUserId) }}</td>
                          <td>{{ w.amount | currency }}</td>
                          <td>{{ w.paidDate ? (w.paidDate | date:'shortDate') : '—' }}</td>
                          <td>{{ w.paidMethod || '—' }}</td>
                          <td class="wage-notes">{{ w.notes || '—' }}</td>
                          <td class="row-actions">
                            <button mat-icon-button matTooltip="Edit" (click)="openWageDialog(c, w)">
                              <mat-icon style="font-size:18px">edit</mat-icon>
                            </button>
                            <button mat-icon-button matTooltip="Delete" (click)="deleteWage(c, w.id)">
                              <mat-icon style="font-size:18px">delete</mat-icon>
                            </button>
                          </td>
                        </tr>
                      }
                    </table>
                    <div style="margin-top:4px">
                      Total wages: <strong>{{ wagesTotal(c) | currency }}</strong>
                    </div>
                  } @else {
                    <div style="color:#777">No wages recorded.</div>
                  }
                  }
                </div>
              </div>
            </td>
          </ng-container>

          <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
          <tr mat-row *matRowDef="let c; columns: displayedColumns;"
              class="computer-row"
              [class.expanded-row]="expandedId === c.id"
              [class.paid-row]="mode === 'sold' || hasAnyPayment(c)"
              (click)="toggleExpand(c)"></tr>
          <tr mat-row *matRowDef="let row; columns: ['expandedDetail']" class="detail-row"></tr>
        </table>
        </div>

        @if (sortedComputers.length === 0) {
          <div style="text-align:center;padding:48px;color:#777">
            @if (mode === 'sold') {
              No sold computers found{{ soldYear === 'all' ? '' : ' for ' + soldYear }}.
            } @else if (activeTab !== 'all') {
              No {{ activeTabLabel }} computers found.
            } @else {
              No in-progress computers found. Click "New Computer" to create one.
            }
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .page-container.wide { max-width: none; }
    .header-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
    .filter-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
    .status-tabs { margin-bottom: 8px; }
    :host ::ng-deep .status-tabs .mat-mdc-tab-body-wrapper { display: none; }
    .search-field { flex: 1 1 200px; min-width: 0; max-width: 100%; }
    .year-field { width: 120px; flex: 0 0 auto; }
    /* Size to column content so the last columns aren't crushed to 0 width
       inside the horizontal scroll container (common on mobile). */
    .computers-table {
      width: max-content;
      min-width: 100%;
      table-layout: auto;
    }
    @media (max-width: 599px) {
      .header-row { margin-bottom: 16px; }
      .detail-content { padding: 8px 12px 16px; }
      .inner-table { display: block; overflow-x: auto; }
    }
    .computers-table th.mat-mdc-header-cell,
    .computers-table td.mat-mdc-cell {
      white-space: nowrap;
      padding: 0 8px;
      font-size: 13px;
    }
    .computer-row { cursor: pointer; height: 48px; }
    .computer-row:hover { background: #f5f5f5; }
    .expanded-row { background: #eef4fb; }
    .detail-row { height: 0; }
    /* grid 0fr/1fr grows with async content (unlike Angular height:'*' which snapshots spinner height) */
    .detail-wrapper {
      display: grid;
      grid-template-rows: 0fr;
      transition: grid-template-rows 200ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .detail-wrapper.open { grid-template-rows: 1fr; }
    .detail-content {
      overflow: hidden;
      min-height: 0;
      padding: 0 24px;
      width: 100%;
      white-space: normal;
    }
    .detail-wrapper.open .detail-content { padding: 8px 24px 24px; }
    .detail-header { display: flex; align-items: center; gap: 16px; }
    .detail-header h3 { margin: 8px 0; }
    .inner-table { border-collapse: collapse; width: 100%; }
    .inner-table th, .inner-table td { text-align: left; padding: 4px 12px 4px 0; border-bottom: 1px solid #eee; font-size: 13px; white-space: nowrap; }
    .name-cell { max-width: 280px; overflow: hidden; text-overflow: ellipsis; }
    .customer-cell {
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .customer-cell a { color: #1565c0; text-decoration: none; }
    .customer-cell a:hover { text-decoration: underline; }
    .customer-cell .ship-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      vertical-align: middle;
      margin-left: 4px;
      color: #666;
    }
    .type-badge {
      font-size: 11px; background: #e3f2fd; color: #1565c0; border-radius: 10px;
      padding: 1px 8px; margin-left: 8px; vertical-align: middle;
    }
    .status-badge { font-size: 12px; border-radius: 10px; padding: 2px 10px; background: #eee; }
    .status-sold { background: #c8e6c9; color: #256029; }
    .status-active { background: #bbdefb; color: #0d47a1; }
    .status-built { background: #d1c4e9; color: #4527a0; }
    .status-personal { background: #f3e5f5; color: #6a1b9a; }
    .status-in-progress { background: #fff9c4; color: #827717; }
    .status-planned { background: #eeeeee; color: #555; }
    .status-needs-repair { background: #ffcdd2; color: #b71c1c; }
    .status-returned { background: #ffe0b2; color: #e65100; }
    .status-traded { background: #b2dfdb; color: #00695c; }
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
    }
    .inline-edit-cell.status-cell { min-width: 130px; }
    .inline-edit-cell.location-cell { min-width: 90px; }
    .inline-edit-cell.builder-cell { min-width: 120px; }
    .inline-select { width: 100%; min-width: 100%; font-size: 13px; }
    :host ::ng-deep .inline-select .mat-mdc-select-trigger {
      min-width: 100%;
    }
    :host ::ng-deep .inline-select .mat-mdc-select-value {
      max-width: none;
    }
    .price-cell {
      cursor: pointer;
      text-decoration: underline dotted transparent;
    }
    .price-cell:hover {
      background: #e3f2fd;
      text-decoration-color: #90caf9;
    }
    .icon-cell {
      white-space: nowrap;
      width: 1%;
    }
    .icon-cell .mat-mdc-icon-button {
      width: 36px;
      height: 36px;
      padding: 6px;
    }
    /* Override global .mat-column-actions { width: 1% } so action buttons can size the column. */
    .computers-table .mat-column-actions,
    .computers-table .actions-cell {
      width: auto;
      min-width: 90px;
      white-space: nowrap;
    }
    .computers-table .mat-column-primaryActions,
    .computers-table .primary-actions-cell {
      width: 1%;
      min-width: 80px;
      white-space: nowrap;
      padding-right: 4px;
    }
    .paid-row td:not(.loc-ben):not(.loc-josh) { background: #f1f8e9; }
    .paid-row td.price-cell:hover { background: #e3f2fd; }
    .paid-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      vertical-align: middle;
      margin-left: 4px;
      color: #2e7d32;
    }
    .josh-sep { color: #999; margin: 0 4px; }
    .loc-ben { background: #c8e6c9; }
    .loc-josh { background: #bbdefb; }
    .warn-cell {
      white-space: nowrap;
      width: 1%;
    }
    .warn-cell .loc-warn {
      font-size: 20px;
      width: 20px;
      height: 20px;
      vertical-align: middle;
      color: #f9a825;
      margin-left: 2px;
    }
    .warn-cell app-missing-parts-icon {
      vertical-align: middle;
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
    .planned-row td { font-style: italic; color: #555; }
    .bulk-row td { border-top: 2px solid #e0e0e0; color: #555; }
    .planned-badge {
      font-size: 11px; font-style: normal;
      background: #fff3e0; color: #e65100;
      border-radius: 8px; padding: 1px 6px; margin-left: 4px;
    }
    .wage-notes {
      max-width: 220px;
      white-space: normal;
      word-break: break-word;
    }
    .row-actions {
      white-space: nowrap;
      width: 1%;
    }
    .row-actions .mat-mdc-icon-button {
      width: 32px;
      height: 32px;
      padding: 4px;
    }
    .part-edit-col {
      width: 40px;
      padding-right: 4px !important;
      white-space: nowrap;
    }
    .part-edit-col .mat-mdc-icon-button {
      width: 32px;
      height: 32px;
      padding: 4px;
    }
    .part-qty {
      font-weight: 700;
      color: #1565c0;
      margin-right: 4px;
    }
  `]
})
export class ComputersComponent implements OnInit {
  partModelText = partModelText;
  partQtyLabel = partQtyLabel;
  computerDisplayName = computerDisplayName;
  mode: ComputersPageMode = 'in-progress';
  displayedColumns: string[] = [];
  computers: Computer[] = [];
  lookups: Lookups | null = null;
  statuses = STATUSES;
  expandedId: number | null = null;
  /** Ids whose parts/payments have been fetched for the expand panel. */
  private detailLoaded = new Set<number>();
  detailLoadingId: number | null = null;
  loading = true;
  search = '';
  searchField = 'search';
  tabs = IN_PROGRESS_TABS;
  activeTab: InProgressTab = 'all';
  /** Sold page year filter; 'all' = no year filter. Defaults to current year. */
  soldYear: number | 'all' = new Date().getFullYear();
  soldYearOptions: number[] = [];

  sortColumn: string | null = null;
  sortDir: 'asc' | 'desc' = 'asc';
  /** True once the user clicks a column header; disables the paid-first default. */
  private userSorted = false;

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * In-progress page: keep these Sold rows visible until the page is left/reloaded,
   * on All and on the tab they were marked from.
   */
  private stickySoldTabs = new Map<number, InProgressTab>();

  constructor(
    private api: ApiService,
    private dialog: MatDialog,
    private snack: MatSnackBar,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    const mode = this.route.snapshot.data['mode'] as ComputersPageMode | undefined;
    this.mode = mode === 'sold' ? 'sold' : 'in-progress';
    this.displayedColumns = this.mode === 'sold'
      ? [
          'warning', 'name', 'builder',
          'partsCost', 'price', 'soldDate', 'tax', 'profit', 'wages', 'joshShare', 'benProfit',
          'paid', 'customer', 'actions'
        ]
      : [
          'primaryActions', 'warning', 'name', 'status', 'location', 'builder',
          'partsCost', 'price', 'profit', 'wages', 'joshShare', 'benProfit',
          'customer', 'actions'
        ];

    if (this.mode === 'sold') {
      this.sortColumn = 'soldDate';
      this.sortDir = 'desc';
    } else {
      this.sortColumn = 'status';
      this.sortDir = 'desc';
    }

    const currentYear = new Date().getFullYear();
    // Cover import history (2024+) through the current year.
    const earliest = 2024;
    this.soldYearOptions = [];
    for (let y = currentYear; y >= earliest; y--) this.soldYearOptions.push(y);
    this.soldYear = currentYear;

    this.api.getLookups().subscribe(l => this.lookups = l);
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

  get tabIndex(): number {
    return this.tabs.findIndex(t => t.key === this.activeTab);
  }

  get activeTabLabel(): string {
    return this.tabs[this.tabIndex]?.label.toLowerCase() ?? '';
  }

  selectTab(index: number): void {
    this.activeTab = this.tabs[index]?.key ?? 'all';
    this.expandedId = null;
  }

  tabCount(tab: InProgressTab): number {
    return this.computers.filter(c => this.inTab(c, tab)).length;
  }

  private inTab(c: Computer, tab: InProgressTab): boolean {
    const stickyTab = this.stickySoldTabs.get(c.id);
    if (stickyTab !== undefined && c.status === 'Sold') return tab === 'all' || tab === stickyTab;
    const def = this.tabs.find(t => t.key === tab);
    if (!def?.statuses) return !EXCLUDED_FROM_ALL.has(c.status);
    return def.statuses.includes(c.status);
  }

  get sortedComputers(): Computer[] {
    const rows = this.mode === 'in-progress'
      ? this.computers.filter(c => this.inTab(c, this.activeTab))
      : this.computers;
    // Default view on the in-progress page: computers with payments first.
    const paidFirst = this.mode === 'in-progress' && !this.userSorted;
    if (!this.sortColumn && !paidFirst) return rows;
    const col = this.sortColumn;
    const dir = this.sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (paidFirst) {
        const paid = Number(this.hasAnyPayment(b)) - Number(this.hasAnyPayment(a));
        if (paid !== 0) return paid;
      }
      if (!col) return 0;
      const av = this.sortValue(a, col);
      const bv = this.sortValue(b, col);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return (a.id - b.id) * dir;
    });
  }

  sortBy(column: string): void {
    this.userSorted = true;
    if (this.sortColumn === column) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDir = 'asc';
    }
  }

  sortIcon(column: string): string {
    if (this.sortColumn !== column) return 'unfold_more';
    return this.sortDir === 'asc' ? 'arrow_upward' : 'arrow_downward';
  }

  private sortValue(c: Computer, column: string): string | number {
    switch (column) {
      case 'warning':
        if (c.missingRequiredTypes?.length && !c.ignoreIncomplete) return 2;
        if (c.hasWrongLocationParts) return 1;
        return 0;
      case 'name':
        return computerDisplayName(c).toLowerCase();
      case 'status':
        return (c.status ?? '').toLowerCase();
      case 'location':
        return (c.location ?? '').toLowerCase();
      case 'builder':
        return (c.builderName ?? c.builderUserId ?? '').toLowerCase();
      case 'partsCost':
        return c.partsCost ?? Number.NEGATIVE_INFINITY;
      case 'price':
        return c.price ?? Number.NEGATIVE_INFINITY;
      case 'soldDate':
        return c.soldDate ? Date.parse(c.soldDate) : Number.NEGATIVE_INFINITY;
      case 'tax':
        return c.tax ?? Number.NEGATIVE_INFINITY;
      case 'profit':
        return c.profit ?? Number.NEGATIVE_INFINITY;
      case 'wages':
        return c.wagesNonJosh ?? 0;
      case 'joshShare':
        return c.joshSharePercentage ?? 0;
      case 'benProfit':
        return c.benProfit ?? Number.NEGATIVE_INFINITY;
      case 'paid':
        if (c.hasPayment) return 2;
        if (c.hasDeposit) return 1;
        return 0;
      case 'customer':
        return (c.customerName ?? '').toLowerCase();
      default:
        return '';
    }
  }

  load(): void {
    this.loading = true;
    this.expandedId = null;
    this.detailLoadingId = null;
    this.detailLoaded.clear();
    // Preserve Sold rows the user marked during this visit (in-progress only).
    const sticky = this.mode === 'in-progress'
      ? this.computers.filter(c => this.stickySoldTabs.has(c.id))
      : [];
    const filters: Record<string, string | number | boolean | undefined> = {};
    if (this.mode === 'sold') {
      filters['soldOnly'] = true;
      if (this.soldYear !== 'all') filters['soldYear'] = this.soldYear;
    } else {
      // Never include sold on the in-progress page. Marking a row Sold updates
      // it in place and leaves it visible until the page is left/reloaded.
      // Traded/Personal are always loaded; tabs filter client-side.
      filters['includeSold'] = false;
      filters['includeTraded'] = true;
      filters['includePersonal'] = true;
    }
    if (this.search) filters[this.searchField] = this.search;
    this.api.getComputers(filters).subscribe({
      next: computers => {
        const mapped = computers.map(c => this.normalizeComputer(c));
        for (const s of sticky) {
          if (!mapped.some(c => c.id === s.id)) {
            mapped.push(this.normalizeComputer(s));
          }
        }
        this.computers = mapped;
        this.loading = false;
      },
      error: () => this.loading = false
    });
  }

  openInvoice(computer: Computer): void {
    void this.router.navigate(['/sold-computers', computer.id, 'invoice']);
  }

  /** Refresh one row from the server without reloading the whole list. */
  private refreshComputer(id: number): void {
    this.api.getComputer(id).subscribe({
      next: detail => {
        const target = this.computers.find(c => c.id === id);
        if (!target) return;
        this.applyComputerDetail(target, detail);
        this.detailLoaded.add(id);
        this.noteIfSold(target, target.status);
      },
      error: () => this.snack.open('Failed to refresh computer', 'OK')
    });
  }

  /** Refresh rows on this page (e.g. Planned PCs that just gave up a part). */
  private refreshListedComputers(ids: number[]): void {
    for (const id of ids) {
      if (this.computers.some(c => c.id === id)) this.refreshComputer(id);
    }
  }

  private normalizeComputer(c: Computer): Computer {
    return {
      ...c,
      parts: c.parts ?? [],
      placeholders: c.placeholders ?? [],
      payments: c.payments ?? [],
      wages: c.wages ?? [],
      shares: c.shares ?? []
    };
  }

  private applyComputerDetail(target: Computer, detail: Computer): void {
    Object.assign(target, detail);
    target.parts = detail.parts ?? [];
    target.placeholders = detail.placeholders ?? [];
    target.payments = detail.payments ?? [];
    target.wages = detail.wages ?? [];
    target.shares = detail.shares ?? [];
    target.shareBase = detail.shareBase;
    target.hasWrongLocationParts = detail.hasWrongLocationParts
      ?? this.computeHasWrongLocationParts(target.location, target.parts);
  }

  /** Part location differs from the computer location (when computer location is set). */
  isWrongLocation(computerLocation: string | null | undefined, partLocation: string | null | undefined): boolean {
    const build = (computerLocation ?? '').trim();
    if (!build) return false;
    return (partLocation ?? '').trim().toLowerCase() !== build.toLowerCase();
  }

  groupHasWrongLocation(c: Computer, g: GroupedPart<Part>): boolean {
    return g.parts.some(p => this.isWrongLocation(c.location, p.location));
  }

  private computeHasWrongLocationParts(
    computerLocation: string | null | undefined,
    parts: Part[] | undefined
  ): boolean {
    if (!parts?.length) return false;
    return parts.some(p => this.isWrongLocation(computerLocation, p.location));
  }

  hasBulk(c: Computer): boolean {
    return !!c.bulkDesc?.trim() || c.bulkCost != null;
  }

  hasAnyPayment(c: Computer): boolean {
    return !!(c.hasPayment || c.hasDeposit);
  }

  private markStickySold(id: number): void {
    if (!this.stickySoldTabs.has(id)) this.stickySoldTabs.set(id, this.activeTab);
  }

  private noteIfSold(computer: Computer, status?: string | null): void {
    if (this.mode === 'in-progress' && (status ?? computer.status) === 'Sold') {
      this.markStickySold(computer.id);
    }
  }

  toggleExpand(computer: Computer): void {
    if (this.expandedId === computer.id) {
      this.expandedId = null;
      return;
    }

    const id = computer.id;
    this.expandedId = id;

    if (this.detailLoaded.has(id)) return;

    this.detailLoadingId = id;
    this.api.getComputer(id).subscribe({
      next: detail => {
        const target = this.computers.find(c => c.id === id) ?? computer;
        this.applyComputerDetail(target, detail);
        this.detailLoaded.add(id);
        if (this.detailLoadingId === id) this.detailLoadingId = null;
      },
      error: () => {
        if (this.detailLoadingId === id) this.detailLoadingId = null;
        if (this.expandedId === id) this.expandedId = null;
        this.snack.open('Failed to load computer details', 'OK');
      }
    });
  }

  setStatus(computer: Computer, status: string): void {
    this.api.setComputerStatus(computer.id, status).subscribe({
      next: res => {
        computer.status = res.status;
        if (res.soldDate) computer.soldDate = res.soldDate;
        this.noteIfSold(computer, res.status);
        // Built/Active/Sold also marks parts received/tested — refresh expand details.
        if (this.detailLoaded.has(computer.id)) this.refreshComputer(computer.id);
        this.snack.open('Status updated', undefined, { duration: 1500 });
      },
      error: err => this.snack.open(err.error?.message ?? 'Failed to update status', 'OK')
    });
  }

  setLocation(computer: Computer, location: string | null): void {
    this.api.setComputerLocation(computer.id, location ?? '').subscribe({
      next: () => {
        computer.location = location;
        const syncParts = ['Built', 'Active', 'Sold'].includes(computer.status);
        if (syncParts && computer.parts?.length) {
          for (const p of computer.parts) p.location = location;
        }
        computer.hasWrongLocationParts =
          this.computeHasWrongLocationParts(computer.location, computer.parts);
        if (syncParts && this.detailLoaded.has(computer.id)) {
          this.refreshComputer(computer.id);
        }
        this.snack.open('Location updated', undefined, { duration: 1500 });
      },
      error: err => this.snack.open(err.error?.message ?? 'Failed to update location', 'OK')
    });
  }

  setBuilder(computer: Computer, builderUserId: string | null): void {
    this.api.setComputerBuilder(computer.id, builderUserId ?? '').subscribe({
      next: res => {
        computer.builderUserId = res.builderUserId;
        computer.builderName = res.builderName;
        this.snack.open('Builder updated', undefined, { duration: 1500 });
      },
      error: err => this.snack.open(err.error?.message ?? 'Failed to update builder', 'OK')
    });
  }

  openPriceEdit(computer: Computer): void {
    const ref = this.dialog.open(PriceEditDialogComponent, {
      data: { name: computerDisplayName(computer), price: computer.price },
      width: '320px'
    });
    ref.afterClosed().subscribe((price: number | null | undefined) => {
      if (price === undefined) return;
      this.api.setComputerPrice(computer.id, price).subscribe({
        next: res => {
          computer.price = res.price;
          computer.tax = res.tax;
          // Price is tax-inclusive: pretax − parts cost − payment fees.
          const oldProfit = computer.profit ?? 0;
          computer.profit = (res.price ?? 0) - (res.tax ?? 0) - (computer.partsCost ?? 0)
            - (computer.paymentFees ?? 0);
          computer.benProfit = (computer.benProfit ?? 0) + (computer.profit - oldProfit);
          computer.profitBen = (computer.profit ?? 0)
            - (computer.wagesBranden ?? 0) - (computer.wagesJosh ?? 0);
          this.snack.open('Price updated', undefined, { duration: 1500 });
        },
        error: err => this.snack.open(err.error?.message ?? 'Failed to update price', 'OK')
      });
    });
  }

  openNewComputer(): void {
    if (!this.lookups) return;
    const partsRef = this.dialog.open(NewComputerPartsDialogComponent, {
      data: { lookups: this.lookups },
      width: '560px',
      maxWidth: '95vw',
      maxHeight: '90vh',
      autoFocus: false,
      panelClass: 'new-computer-parts-panel'
    });
    partsRef.afterClosed().subscribe(partsResult => {
      if (!partsResult) return;
      this.openComputerDialog(null, {
        partIds: partsResult.partIds,
        takenFromIds: partsResult.takenFromIds
      });
    });
  }

  openComputerDialog(
    computer: Computer | null,
    createOpts?: { partIds?: number[]; takenFromIds?: number[] }
  ): void {
    if (!this.lookups) return;
    const ref = this.dialog.open(ComputerDialogComponent, {
      data: {
        computer,
        lookups: this.lookups
      },
      width: '520px',
      maxWidth: '95vw',
      maxHeight: '90vh'
    });
    ref.afterClosed().subscribe(result => {
      if (!result) return;
      const req = result.id
        ? this.api.updateComputer(result.id, result)
        : this.api.createComputer(result);
      req.subscribe({
        next: saved => {
          if (computer && saved?.status === 'Sold') this.noteIfSold(computer, saved.status);
          else if (result.status === 'Sold' && result.id) this.markStickySold(result.id);

          const newId = saved?.id ?? result.id;
          const partIds = createOpts?.partIds ?? [];
          if (!result.id && newId && partIds.length) {
            this.api.assignParts(newId, partIds).subscribe({
              next: () => {
                this.snack.open('Computer created with parts', undefined, { duration: 2000 });
                this.insertOrRefreshComputer(newId);
                this.refreshListedComputers(createOpts?.takenFromIds ?? []);
              },
              error: err => {
                this.snack.open(err.error?.message ?? 'Computer created but assigning parts failed', 'OK');
                this.insertOrRefreshComputer(newId);
              }
            });
            return;
          }

          this.snack.open('Computer saved', undefined, { duration: 2000 });
          if (result.id) this.refreshComputer(result.id);
          else if (newId) this.insertOrRefreshComputer(newId);
          else this.load();
        },
        error: err => this.snack.open(err.error?.message ?? 'Save failed', 'OK')
      });
    });
  }

  openPaymentDialog(computer: Computer): void {
    const ref = this.dialog.open(PaymentDialogComponent, { data: { computer } });
    ref.afterClosed().subscribe(result => {
      if (!result) return;
      this.api.addPayment(computer.id, result).subscribe({
        next: () => {
          this.snack.open('Payment recorded', undefined, { duration: 2000 });
          this.refreshComputer(computer.id);
        },
        error: err => this.snack.open(err.error?.message ?? 'Failed to record payment', 'OK')
      });
    });
  }

  openEditPart(computer: Computer, part: Part): void {
    if (!this.lookups) return;
    const ref = this.dialog.open(PartDialogComponent, {
      data: { part, lookups: this.lookups },
      maxHeight: '96vh'
    });
    ref.afterClosed().subscribe(result => {
      if (!result?.id) return;
      this.api.updatePart(result.id, result).subscribe({
        next: () => {
          this.snack.open('Part saved', undefined, { duration: 2000 });
          this.refreshComputer(computer.id);
        },
        error: err => this.snack.open(err.error?.message ?? 'Failed to save part', 'OK')
      });
    });
  }

  groupedParts(computer: Computer): GroupedPart<Part>[] {
    return groupIdenticalParts(computer.parts ?? []);
  }

  groupCost(g: GroupedPart<Part>): number {
    return g.parts.reduce((sum, p) => sum + (p.cost ?? 0), 0);
  }

  groupField(g: GroupedPart<Part>, field: 'condition' | 'location'): string {
    const first = g.parts[0]?.[field] ?? null;
    const same = g.parts.every(p => (p[field] ?? null) === first);
    return same ? (first || '—') : '—';
  }

  groupReceived(g: GroupedPart<Part>): string {
    if (g.parts.every(p => p.received)) return '✔';
    if (g.parts.every(p => !p.received)) return '✘';
    return 'Mixed';
  }

  groupTested(g: GroupedPart<Part>): string {
    const status = (p: Part) =>
      p.testedDate ? 'yes' : (p.condition === 'Used' ? 'no' : 'na');
    const first = status(g.parts[0]);
    if (!g.parts.every(p => status(p) === first)) return 'Mixed';
    if (first === 'yes') return '✔';
    if (first === 'no') return '✘';
    return 'n/a';
  }

  openAssignParts(computer: Computer): void {
    if (!this.lookups) return;
    const ref = this.dialog.open(AssignPartsDialogComponent, {
      data: { computer, lookups: this.lookups },
      maxHeight: '90vh'
    });
    ref.afterClosed().subscribe((result: {
      partIds: number[]; placeholders?: unknown; takenFromIds?: number[]
    } | number[] | undefined) => {
      if (!result) return;
      const partIds = Array.isArray(result) ? result : result.partIds;
      if (!partIds) return;
      const takenFromIds = Array.isArray(result) ? [] : result.takenFromIds ?? [];
      this.api.assignParts(computer.id, partIds).subscribe({
        next: () => {
          this.snack.open('Parts updated', undefined, { duration: 2000 });
          this.refreshComputer(computer.id);
          this.refreshListedComputers(takenFromIds);
        },
        error: err => this.snack.open(err.error?.message ?? 'Failed to update parts', 'OK')
      });
    });
  }

  deletePayment(computer: Computer, paymentId: number): void {
    if (!confirm('Delete this payment?')) return;
    this.api.deletePayment(computer.id, paymentId).subscribe({
      next: () => {
        this.snack.open('Payment deleted', undefined, { duration: 2000 });
        this.refreshComputer(computer.id);
      },
      error: err => this.snack.open(err.error?.message ?? 'Failed to delete payment', 'OK')
    });
  }

  builderLabel(builderUserId: string): string {
    const u = this.lookups?.users.find(x => x.id === builderUserId);
    return u?.name ?? builderUserId;
  }

  wagesTotal(computer: Computer): number {
    return (computer.wages ?? []).reduce((sum, w) => sum + (w.amount ?? 0), 0);
  }

  openWageDialog(computer: Computer, wage?: Wage): void {
    if (!this.lookups) return;
    const ref = this.dialog.open(WageDialogComponent, {
      data: { computer, lookups: this.lookups, wage: wage ?? null }
    });
    ref.afterClosed().subscribe(result => {
      if (!result) return;
      const req = wage
        ? this.api.updateWage(wage.id, { ...result, id: wage.id })
        : this.api.createWage(result);
      req.subscribe({
        next: () => {
          this.snack.open(wage ? 'Wage updated' : 'Wage added', undefined, { duration: 2000 });
          this.refreshComputer(computer.id);
        },
        error: err => this.snack.open(err.error?.message ?? 'Failed to save wage', 'OK')
      });
    });
  }

  deleteWage(computer: Computer, wageId: number): void {
    if (!confirm('Delete this wage?')) return;
    this.api.deleteWage(wageId).subscribe({
      next: () => {
        this.snack.open('Wage deleted', undefined, { duration: 2000 });
        this.refreshComputer(computer.id);
      },
      error: err => this.snack.open(err.error?.message ?? 'Failed to delete wage', 'OK')
    });
  }

  openShareDialog(computer: Computer, share?: ComputerShare): void {
    if (!this.lookups) return;
    const ref = this.dialog.open(ShareDialogComponent, {
      data: { computer, lookups: this.lookups, share: share ?? null }
    });
    ref.afterClosed().subscribe(result => {
      if (!result) return;
      const req = share
        ? this.api.updateShare(share.id, { ...result, id: share.id })
        : this.api.createShare(result);
      req.subscribe({
        next: () => {
          this.snack.open(share ? 'Share updated' : 'Share added', undefined, { duration: 2000 });
          this.refreshComputer(computer.id);
        },
        error: err => this.snack.open(err.error?.message ?? 'Failed to save share', 'OK')
      });
    });
  }

  deleteShare(computer: Computer, shareId: number): void {
    if (!confirm('Delete this share?')) return;
    this.api.deleteShare(shareId).subscribe({
      next: () => {
        this.snack.open('Share deleted', undefined, { duration: 2000 });
        this.refreshComputer(computer.id);
      },
      error: err => this.snack.open(err.error?.message ?? 'Failed to delete share', 'OK')
    });
  }

  deleteComputer(computer: Computer): void {
    if (!confirm(`Delete "${computerDisplayName(computer)}"? Its parts will be released back to inventory.`)) return;
    this.api.deleteComputer(computer.id).subscribe({
      next: () => {
        this.snack.open('Computer deleted', undefined, { duration: 2000 });
        this.removeComputerFromList(computer.id);
      },
      error: err => this.snack.open(err.error?.message ?? 'Delete failed', 'OK')
    });
  }

  /** Fetch and patch an existing row, or insert it if missing (e.g. after create). */
  private insertOrRefreshComputer(id: number): void {
    this.api.getComputer(id).subscribe({
      next: detail => {
        const existing = this.computers.find(c => c.id === id);
        if (existing) {
          this.applyComputerDetail(existing, detail);
          this.detailLoaded.add(id);
          this.noteIfSold(existing, existing.status);
          return;
        }
        const row = this.normalizeComputer(detail);
        this.computers = [row, ...this.computers];
        this.detailLoaded.add(id);
        this.noteIfSold(row, row.status);
      },
      error: () => this.load()
    });
  }

  private removeComputerFromList(id: number): void {
    this.computers = this.computers.filter(c => c.id !== id);
    this.detailLoaded.delete(id);
    this.stickySoldTabs.delete(id);
    if (this.expandedId === id) this.expandedId = null;
    if (this.detailLoadingId === id) this.detailLoadingId = null;
  }

  copyPublicLink(computer: Computer): void {
    const url = `${window.location.origin}/build/${computer.id}`;
    navigator.clipboard.writeText(url);
    this.snack.open('Public link copied: ' + url, undefined, { duration: 3000 });
  }

  copyPartsList(computer: Computer): void {
    const write = (parts: Part[]) => {
      const lines = sortByPartType(parts)
        .map(p => {
          const mfr = (p.manufacturer ?? '').trim();
          const model = (p.modelNumber ?? '').trim();
          return [mfr, model].filter(Boolean).join(' ');
        })
        .filter(line => !!line);
      if (!lines.length) {
        this.snack.open('No parts to copy', undefined, { duration: 2000 });
        return;
      }
      navigator.clipboard.writeText(lines.join('\n'));
      this.snack.open(`Copied ${lines.length} part${lines.length === 1 ? '' : 's'}`, undefined, {
        duration: 2000
      });
    };

    if (this.detailLoaded.has(computer.id)) {
      write(computer.parts ?? []);
      return;
    }

    this.api.getComputer(computer.id).subscribe({
      next: detail => {
        const target = this.computers.find(c => c.id === computer.id);
        if (target) {
          this.applyComputerDetail(target, detail);
          this.detailLoaded.add(computer.id);
        }
        write(detail.parts ?? []);
      },
      error: () => this.snack.open('Failed to load parts', 'OK')
    });
  }
}
