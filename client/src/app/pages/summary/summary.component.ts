import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { animate, state, style, transition, trigger } from '@angular/animations';
import { ApiService } from '../../services/api.service';
import { MonthlySummaryReport, MonthlySummaryRow } from '../../models';

@Component({
  selector: 'app-summary',
  standalone: true,
  imports: [CommonModule, FormsModule, MatTableModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatSelectModule, MatProgressSpinnerModule, MatTooltipModule,
    MatSlideToggleModule],
  animations: [
    trigger('detailExpand', [
      state('collapsed', style({ height: '0px', minHeight: '0' })),
      state('expanded', style({ height: '*' })),
      transition('expanded <=> collapsed', animate('200ms cubic-bezier(0.4, 0.0, 0.2, 1)'))
    ])
  ],
  template: `
    <div class="page-container">
      <div class="header-row">
        <h1>Monthly Summary</h1>
        <span class="spacer"></span>
        <mat-form-field appearance="outline" class="year-field">
          <mat-label>Year</mat-label>
          <mat-select [(ngModel)]="year" (selectionChange)="load()">
            @for (y of availableYears; track y) {
              <mat-option [value]="y">{{ y }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-slide-toggle [(ngModel)]="wagesBySaleDate" (change)="load()"
                          matTooltip="When on, month wages are those assigned to computers sold that month (even if paid later)">
          Wages by sale date
        </mat-slide-toggle>
      </div>

      <p class="hint">
        Totals for sold PCs by sale date — matching the spreadsheet monthly TAXES rows.
        Profit is pretax revenue minus parts cost minus payment fees minus wages
        ({{ wagesBySaleDate ? 'by computer sale date' : 'by paid date' }}).
        Sales with no tax are counted as exempt.
      </p>

      @if (loading) {
        <div style="display:flex;justify-content:center;padding:48px">
          <mat-spinner></mat-spinner>
        </div>
      } @else if (report) {
        <div class="table-scroll">
        <table mat-table [dataSource]="displayRows" multiTemplateDataRows class="mat-elevation-z1 summary-table">

          <ng-container matColumnDef="month">
            <th mat-header-cell *matHeaderCellDef>Month</th>
            <td mat-cell *matCellDef="let m">
              <strong>{{ m.monthName }}</strong>
              @if (m.soldCount) {
                <span class="count-badge">{{ m.soldCount }} sale{{ m.soldCount === 1 ? '' : 's' }}</span>
              }
            </td>
            <td mat-footer-cell *matFooterCellDef><strong>Year total</strong></td>
          </ng-container>

          <ng-container matColumnDef="totalSales">
            <th mat-header-cell *matHeaderCellDef>Total Sales</th>
            <td mat-cell *matCellDef="let m">{{ m.totalSales | currency }}</td>
            <td mat-footer-cell *matFooterCellDef><strong>{{ report.yearTotals.totalSales | currency }}</strong></td>
          </ng-container>

          <ng-container matColumnDef="exemptSales">
            <th mat-header-cell *matHeaderCellDef>
              Exempt
              <mat-icon class="hint-icon" matTooltip="Sales with $0 tax">info</mat-icon>
            </th>
            <td mat-cell *matCellDef="let m">{{ m.exemptSales | currency }}</td>
            <td mat-footer-cell *matFooterCellDef><strong>{{ report.yearTotals.exemptSales | currency }}</strong></td>
          </ng-container>

          <ng-container matColumnDef="totalBeforeTax">
            <th mat-header-cell *matHeaderCellDef>Before Tax</th>
            <td mat-cell *matCellDef="let m">{{ m.totalBeforeTax | currency }}</td>
            <td mat-footer-cell *matFooterCellDef><strong>{{ report.yearTotals.totalBeforeTax | currency }}</strong></td>
          </ng-container>

          <ng-container matColumnDef="taxDue">
            <th mat-header-cell *matHeaderCellDef>Tax Due</th>
            <td mat-cell *matCellDef="let m">{{ m.taxDue | currency }}</td>
            <td mat-footer-cell *matFooterCellDef><strong>{{ report.yearTotals.taxDue | currency }}</strong></td>
          </ng-container>

          <ng-container matColumnDef="partsCost">
            <th mat-header-cell *matHeaderCellDef>Parts Cost</th>
            <td mat-cell *matCellDef="let m">{{ m.partsCost | currency }}</td>
            <td mat-footer-cell *matFooterCellDef><strong>{{ report.yearTotals.partsCost | currency }}</strong></td>
          </ng-container>

          <ng-container matColumnDef="wages">
            <th mat-header-cell *matHeaderCellDef>
              Wages
              <mat-icon class="hint-icon"
                        [matTooltip]="wagesBySaleDate
                          ? 'Builder wages for computers sold this month (any paid date)'
                          : 'Builder wages paid in this month (by paid date)'">info</mat-icon>
            </th>
            <td mat-cell *matCellDef="let m">{{ m.wages | currency }}</td>
            <td mat-footer-cell *matFooterCellDef><strong>{{ report.yearTotals.wages | currency }}</strong></td>
          </ng-container>

          <ng-container matColumnDef="profit">
            <th mat-header-cell *matHeaderCellDef>
              Profit
              <mat-icon class="hint-icon" matTooltip="Before tax − parts cost − wages">info</mat-icon>
            </th>
            <td mat-cell *matCellDef="let m">
              <span [class.ok-text]="m.profit > 0" [class.warn-text]="m.profit < 0">
                {{ m.profit | currency }}
              </span>
            </td>
            <td mat-footer-cell *matFooterCellDef>
              <strong [class.ok-text]="report.yearTotals.profit > 0"
                      [class.warn-text]="report.yearTotals.profit < 0">
                {{ report.yearTotals.profit | currency }}
              </strong>
            </td>
          </ng-container>

          <ng-container matColumnDef="expandedDetail">
            <td mat-cell *matCellDef="let m" [attr.colspan]="displayedColumns.length">
              <div class="detail-wrapper" [@detailExpand]="m === expanded ? 'expanded' : 'collapsed'">
                <div class="detail-content">
                  @if (m.sales.length) {
                    <table class="inner-table">
                      <tr>
                        <th>Sold</th>
                        <th>Computer</th>
                        <th>Customer</th>
                        <th>Price</th>
                        <th>Tax</th>
                        <th>Before Tax</th>
                        <th>Parts</th>
                        <th>Wages</th>
                        <th>Profit</th>
                      </tr>
                      @for (s of m.sales; track s.id) {
                        <tr>
                          <td>{{ s.soldDate | date:'M/d/yyyy' }}</td>
                          <td>{{ s.name }}</td>
                          <td>{{ s.customerName || '—' }}</td>
                          <td>{{ s.price | currency }}</td>
                          <td>
                            @if (s.isExempt) {
                              <span class="exempt-tag">exempt</span>
                            } @else {
                              {{ s.tax | currency }}
                            }
                          </td>
                          <td>{{ s.beforeTax | currency }}</td>
                          <td>{{ s.partsCost | currency }}</td>
                          <td>
                            @if (s.wages?.length) {
                              <div class="wage-list"
                                   [matTooltip]="wageTooltip(s)">
                                @for (w of s.wages; track w.id) {
                                  <div>{{ w.amount | currency }} <span class="wage-builder">{{ w.builderUserId }}</span></div>
                                }
                              </div>
                            } @else {
                              —
                            }
                          </td>
                          <td>
                            <span [class.ok-text]="s.profit > 0" [class.warn-text]="s.profit < 0">
                              {{ s.profit | currency }}
                            </span>
                          </td>
                        </tr>
                      }
                    </table>
                  } @else {
                    <div class="empty-month">No sales this month</div>
                  }
                </div>
              </div>
            </td>
          </ng-container>

          <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
          <tr mat-row *matRowDef="let m; columns: displayedColumns"
              class="month-row"
              [class.empty-row]="!m.soldCount"
              [class.expanded-row]="expanded === m"
              (click)="toggle(m)"></tr>
          <tr mat-row *matRowDef="let m; columns: ['expandedDetail']" class="detail-row"></tr>
          <tr mat-footer-row *matFooterRowDef="displayedColumns"></tr>
        </table>
        </div>
      }
    </div>
  `,
  styles: [`
    .header-row { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; flex-wrap: wrap; }
    .header-row h1 { margin: 0; font-size: 1.6rem; }
    .year-field { width: 120px; }
    .hint { color: #666; font-size: 13px; margin: 0 0 16px; }
    .summary-table { min-width: 640px; width: 100%; }
    .detail-content { overflow-x: auto; }
    @media (max-width: 599px) {
      .header-row h1 { font-size: 1.35rem; }
      .hint { font-size: 12px; }
    }
    .count-badge {
      margin-left: 8px;
      font-size: 11px;
      background: #e3f2fd;
      color: #1565c0;
      border-radius: 10px;
      padding: 1px 8px;
      font-weight: normal;
    }
    .hint-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      vertical-align: middle;
      color: #999;
      cursor: help;
    }
    .month-row { cursor: pointer; }
    .month-row:hover { background: #f5f5f5; }
    .empty-row td { color: #aaa; }
    .expanded-row { background: #f0f7ff; }
    .detail-row td { padding: 0 !important; border-bottom-width: 0; }
    .detail-wrapper { overflow: hidden; }
    .detail-content { padding: 12px 16px 16px; background: #fafafa; }
    .inner-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .inner-table th, .inner-table td { text-align: left; padding: 4px 10px; border-bottom: 1px solid #eee; }
    .inner-table th { color: #666; font-weight: 500; }
    .empty-month { color: #999; font-size: 13px; padding: 4px 0; }
    .exempt-tag {
      font-size: 11px;
      background: #fff3e0;
      color: #e65100;
      border-radius: 8px;
      padding: 1px 6px;
    }
    .wage-list { line-height: 1.35; }
    .wage-builder { color: #777; font-size: 11px; }
    tr.mat-mdc-footer-row td { border-top: 2px solid #ccc; background: #f5f5f5; }
  `]
})
export class SummaryComponent implements OnInit {
  loading = false;
  year = new Date().getFullYear();
  /** Off by default: wages count in the month they were paid. On: month of computer sale. */
  wagesBySaleDate = false;
  availableYears: number[] = [this.year];
  report: MonthlySummaryReport | null = null;
  displayRows: MonthlySummaryRow[] = [];
  expanded: MonthlySummaryRow | null = null;
  displayedColumns = ['month', 'totalSales', 'exemptSales', 'totalBeforeTax', 'taxDue', 'partsCost', 'wages', 'profit'];

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.expanded = null;
    this.api.getMonthlySummary(this.year, this.wagesBySaleDate).subscribe({
      next: (r) => {
        this.report = r;
        this.year = r.year;
        this.availableYears = r.availableYears?.length ? r.availableYears : [r.year];
        this.displayRows = r.months ?? [];
        this.loading = false;
      },
      error: () => { this.loading = false; }
    });
  }

  toggle(m: MonthlySummaryRow): void {
    this.expanded = this.expanded === m ? null : m;
  }

  wageTooltip(s: { wages: { amount: number; builderUserId: string; paidDate?: string | null; paidMethod?: string | null }[] }): string {
    return s.wages.map(w => {
      const date = w.paidDate ? new Date(w.paidDate).toLocaleDateString() : 'no date';
      const method = w.paidMethod || '—';
      return `${w.builderUserId}: $${w.amount.toFixed(2)} (${date}, ${method})`;
    }).join('\n');
  }
}
