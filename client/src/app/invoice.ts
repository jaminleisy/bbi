import { Computer, Part, Payment } from './models';
import { partDisplayLabel, partTypeRank } from './part-display';

export const INVOICE_FROM_LINES = [
  'David Leisy',
  '5025 Magic Lantern Dr',
  'Knoxville, TN 37918',
  '(865) 219-3181'
];

const STANDARD_EXTRAS = [
  'Windows 11 newly installed and activated',
  '6-month warranty on all parts'
];

/** Preferred bullet order for invoice descriptions (template-style). */
const INVOICE_TYPE_ORDER = [
  'gpu', 'cpu', 'storage', 'ram', 'mobo', 'cpuCooler', 'case', 'psu'
];

export interface InvoicePaymentRow {
  typeLabel: string;
  dateLabel: string;
  amount: number;
}

export interface InvoiceViewModel {
  computerId: number;
  title: string;
  customerName: string;
  soldDateLabel: string;
  bullets: string[];
  quantity: number;
  lineAmount: number;
  subtotal: number;
  tax: number;
  total: number;
  payments: InvoicePaymentRow[];
  balanceDue: number;
  fromLines: string[];
}

/**
 * Extract a short GPU chip label for the invoice title line
 * (e.g. "RTX 5060", "RX 9070 XT") from a GPU part's model/manufacturer text.
 */
export function gpuChipLabel(part: Part | null | undefined): string | null {
  if (!part) return null;
  const text = [part.manufacturer, part.modelNumber].filter(Boolean).join(' ');
  if (!text.trim()) return null;

  const patterns = [
    /\b(RTX\s*A?\d{3,5}\s*(?:Ti|SUPER)?)\b/i,
    /\b(GTX\s*\d{3,4}\s*(?:Ti|SUPER)?)\b/i,
    /\b(RX\s*\d{3,4}\s*(?:XT|GRE|X)?)\b/i,
    /\b(Arc\s*[A-Z]?\d{3,4})\b/i
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const chip = m[1].replace(/\s+/g, ' ').trim();
    if (/^arc\b/i.test(chip)) {
      return chip.replace(/^arc\s*/i, 'Arc ');
    }
    return chip.toUpperCase();
  }
  return null;
}

export function gamingPcTitle(parts: Part[]): string {
  const gpu = parts.find(p => (p.type ?? '').toLowerCase() === 'gpu');
  const chip = gpuChipLabel(gpu);
  if (chip) return `${chip} Gaming PC`;
  return 'Gaming PC';
}

function typeSuffix(type: string): string {
  switch (type.toLowerCase()) {
    case 'gpu': return 'graphics card';
    case 'cpu': return 'CPU';
    case 'storage': return 'storage';
    case 'ram': return 'RAM';
    case 'mobo': return 'motherboard';
    case 'cpucooler': return 'CPU cooler';
    case 'case': return 'case';
    case 'psu': return 'power supply';
    default: return '';
  }
}

function invoiceTypeRank(type: string): number {
  const t = type.toLowerCase();
  const idx = INVOICE_TYPE_ORDER.indexOf(t);
  if (idx >= 0) return idx;
  return 100 + partTypeRank(type);
}

/** Build bullet lines for the item description (excluding the title line). */
export function invoiceBulletLines(computer: Computer): string[] {
  const parts = (computer.parts ?? [])
    .filter(p => {
      const t = (p.type ?? '').toLowerCase();
      // Covered by the standard Windows line; skip license keys.
      return t !== 'winkey';
    })
    .sort((a, b) => {
      const r = invoiceTypeRank(a.type) - invoiceTypeRank(b.type);
      if (r !== 0) return r;
      return partDisplayLabel(a).localeCompare(partDisplayLabel(b));
    });

  const bullets: string[] = [];
  for (const p of parts) {
    const label = partDisplayLabel(p, '').trim();
    if (!label) continue;
    const suffix = typeSuffix(p.type);
    const line = suffix && !label.toLowerCase().endsWith(suffix.toLowerCase())
      ? `${label} ${suffix}`
      : label;
    bullets.push(line);
  }

  for (const ph of computer.placeholders ?? []) {
    const desc = ph.description?.trim();
    if (desc) bullets.push(desc);
  }

  bullets.push(...STANDARD_EXTRAS);
  return bullets;
}

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function paymentRows(payments: Payment[]): InvoicePaymentRow[] {
  return [...payments]
    .sort((a, b) => {
      const ta = a.date ? Date.parse(a.date) : 0;
      const tb = b.date ? Date.parse(b.date) : 0;
      return ta - tb;
    })
    .map(p => {
      const sign = p.type === 'refund' ? -1 : 1;
      return {
        typeLabel: [p.type, p.method].filter(Boolean).join(' · ') || '—',
        dateLabel: formatDate(p.date),
        amount: sign * (p.amount ?? 0)
      };
    });
}

/** Build printable invoice view-model data for a sold computer. */
export function buildInvoiceViewModel(computer: Computer): InvoiceViewModel {
  const price = computer.price ?? 0;
  const tax = computer.tax ?? 0;
  const subtotal = round2(price - tax);
  const netPaid = computer.netPaid
    ?? (computer.payments ?? []).reduce((sum, p) =>
      sum + (p.type === 'refund' ? -p.amount : p.amount), 0);
  const balanceDue = Math.max(0, round2(price - netPaid));

  return {
    computerId: computer.id,
    title: gamingPcTitle(computer.parts ?? []),
    customerName: computer.customerName?.trim() || '—',
    soldDateLabel: formatDate(computer.soldDate),
    bullets: invoiceBulletLines(computer),
    quantity: 1,
    lineAmount: subtotal,
    subtotal,
    tax,
    total: price,
    payments: paymentRows(computer.payments ?? []),
    balanceDue,
    fromLines: INVOICE_FROM_LINES
  };
}
