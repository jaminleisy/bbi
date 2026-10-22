import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiService } from '../../services/api.service';
import { buildInvoiceViewModel, InvoiceViewModel } from '../../invoice';

@Component({
  selector: 'app-invoice-page',
  standalone: true,
  imports: [CommonModule, RouterLink, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="invoice-page">
      <div class="toolbar no-print">
        <a mat-button routerLink="/sold-computers">
          <mat-icon>arrow_back</mat-icon> Back to Sold
        </a>
        <span class="spacer"></span>
        <button mat-flat-button color="primary" [disabled]="!invoice" (click)="print()">
          <mat-icon>print</mat-icon> Print
        </button>
      </div>

      @if (loading) {
        <div class="center"><mat-spinner></mat-spinner></div>
      } @else if (error) {
        <div class="empty no-print">{{ error }}</div>
      } @else if (invoice) {
        <article class="invoice">
          <h1>INVOICE <span class="invoice-id">#{{ invoice.computerId }}</span></h1>

          <div class="meta">
            <div>
              <div class="label">FROM:</div>
              <div class="from-block">
                @for (line of invoice.fromLines; track line) {
                  <div>{{ line }}</div>
                }
              </div>
            </div>
            <div>
              <div class="to-row"><span class="label">TO:</span> {{ invoice.customerName }}</div>
              <div class="date-row"><span class="label">DATE:</span> {{ invoice.soldDateLabel }}</div>
            </div>
          </div>

          <table class="items">
            <thead>
              <tr>
                <th>Item Description</th>
                <th class="num">Quantity</th>
                <th class="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <div class="item-title">{{ invoice.title }}</div>
                  <ul class="item-bullets">
                    @for (b of invoice.bullets; track $index) {
                      <li>{{ b }}</li>
                    }
                  </ul>
                </td>
                <td class="num">{{ invoice.quantity }}</td>
                <td class="num">{{ invoice.lineAmount | currency }}</td>
              </tr>
            </tbody>
          </table>

          <div class="totals">
            <div class="totals-row"><span>Subtotal</span><span>{{ invoice.subtotal | currency }}</span></div>
            <div class="totals-row"><span>Sales Tax</span><span>{{ invoice.tax | currency }}</span></div>
            <div class="totals-row total"><span>Total</span><span>{{ invoice.total | currency }}</span></div>
          </div>

          <div class="payments-head">Payments</div>
          <table class="payments">
            <thead>
              <tr>
                <th>Payment Type</th>
                <th>Payment Date</th>
                <th class="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              @if (invoice.payments.length) {
                @for (p of invoice.payments; track $index) {
                  <tr>
                    <td>{{ p.typeLabel }}</td>
                    <td>{{ p.dateLabel }}</td>
                    <td class="num">{{ p.amount | currency }}</td>
                  </tr>
                }
              } @else {
                <tr><td colspan="3" class="muted">No payments recorded</td></tr>
              }
            </tbody>
          </table>

          <div class="balance">Balance Due: {{ invoice.balanceDue | currency }}</div>
        </article>
      }
    </div>
  `,
  styles: [`
    .invoice-page {
      max-width: 860px;
      margin: 0 auto;
      padding: 12px 16px 32px;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .spacer { flex: 1; }
    .center { display: flex; justify-content: center; padding: 48px; }
    .empty { text-align: center; padding: 48px; color: #777; }

    .invoice {
      background: #fff;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      padding: 28px 32px;
      color: #111;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 14px;
      line-height: 1.4;
    }
    .invoice h1 {
      font-size: 32px;
      font-weight: 700;
      margin: 0 0 20px;
      letter-spacing: 0.02em;
      font-family: Arial, Helvetica, sans-serif;
    }
    .invoice-id {
      font-size: 20px;
      font-weight: 600;
      letter-spacing: 0;
      color: #444;
      margin-left: 8px;
    }
    .meta {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px 32px;
      margin-bottom: 28px;
    }
    .label { font-weight: 700; }
    .from-block { margin-top: 4px; }
    .to-row .label { margin-right: 6px; }
    .date-row { margin-top: 28px; }
    .date-row .label { margin-right: 6px; }
    table.items, table.payments {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
    }
    table.items th, table.payments th {
      text-align: left;
      border-bottom: 2px solid #222;
      padding: 8px 6px;
      font-size: 14px;
    }
    table.items th.num, table.items td.num,
    table.payments th.num, table.payments td.num {
      text-align: right;
      white-space: nowrap;
    }
    table.items td, table.payments td {
      padding: 8px 6px;
      vertical-align: top;
      border-bottom: 1px solid #ddd;
    }
    .item-title { font-weight: 700; margin: 0 0 6px; }
    .item-bullets { margin: 0; padding-left: 18px; }
    .item-bullets li { margin: 2px 0; }
    .totals {
      width: 280px;
      margin-left: auto;
      margin-top: 16px;
    }
    .totals-row {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
      border-bottom: 1px solid #eee;
    }
    .totals-row.total {
      font-weight: 700;
      font-size: 16px;
      border-bottom: 2px solid #222;
      margin-top: 4px;
      padding-top: 8px;
    }
    .payments-head {
      margin: 28px 0 0;
      font-weight: 700;
      font-size: 15px;
    }
    .balance {
      margin-top: 16px;
      font-size: 16px;
      font-weight: 700;
      text-align: right;
    }
    .muted { color: #777; }

    @media print {
      :host { display: block; }
      .invoice-page { max-width: none; padding: 0; }
      .invoice {
        border: none;
        border-radius: 0;
        padding: 0;
        box-shadow: none;
      }
      .no-print { display: none !important; }
    }
  `]
})
export class InvoicePageComponent implements OnInit {
  loading = true;
  error: string | null = null;
  invoice: InvoiceViewModel | null = null;

  constructor(
    private route: ActivatedRoute,
    private api: ApiService
  ) {}

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!Number.isFinite(id) || id <= 0) {
      this.error = 'Invalid computer.';
      this.loading = false;
      return;
    }

    this.api.getComputer(id).subscribe({
      next: computer => {
        this.invoice = buildInvoiceViewModel(computer);
        this.loading = false;
      },
      error: () => {
        this.error = 'Could not load this computer for invoicing.';
        this.loading = false;
      }
    });
  }

  print(): void {
    window.print();
  }
}
