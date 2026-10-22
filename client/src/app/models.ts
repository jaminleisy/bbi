export interface Part {
  id: number;
  type: string;
  manufacturer?: string | null;
  modelNumber?: string | null;
  cost?: number | null;
  orderDate?: string | null;
  orderUrl?: string | null;
  seller?: string | null;
  color?: string | null;
  hasRgb: boolean;
  cpuSocket?: string | null;
  pcieGen?: string | null;
  ramType?: string | null;
  location?: string | null;
  received: boolean;
  testedDate?: string | null;
  testedUserId?: string | null;
  condition?: string | null;
  returnByDate?: string | null;
  merchant?: string | null;
  notes?: string | null;
  /** 1 = possibly bad, 2 = confirmed bad */
  bad?: number | null;
  /** 1 = possibly scam, 2 = confirmed scam */
  scam?: number | null;
  /** 1 = possibly lost, 2 = confirmed lost */
  lost?: number | null;
  computerId?: number | null;

  computerName?: string | null;
  /** Status of the assigned computer (e.g. Sold), when computerId is set. */
  computerStatus?: string | null;
  /** Location of the assigned computer/build, when computerId is set. */
  computerLocation?: string | null;
}

export interface PartImageMeta {
  id: number;
  partId: number;
  contentType: string;
  /** import | receiving | testing */
  source?: string | null;
  createdDate: string;
  createdUserId?: string | null;
}

export type CheckOffTestOutcome = 'good' | 'possiblyBad' | 'definitelyBad' | 'scam';

export interface Payment {
  id: number;
  computerId: number;
  amount: number;
  tax?: number | null;
  fee?: number | null;
  method?: string | null;
  date: string;
  paymentUrl?: string | null;
  type: 'payment' | 'deposit' | 'refund';
}

export interface Wage {
  id: number;
  builderUserId: string;
  computerId?: number | null;
  amount: number;
  paidDate?: string | null;
  paidMethod?: string | null;
  notes?: string | null;
}

/** Advisory profit-share percentage for a builder on a computer. */
export interface ComputerShare {
  id: number;
  computerId: number;
  builderUserId: string;
  builderName?: string | null;
  percentage: number;
  /** Suggested payout = shareBase × percentage / 100 (from computer detail). */
  amount?: number;
}

/** Planned part slot (custom text) — not inventory; never on Parts page. */
export interface PartPlaceholder {
  id: number;
  computerId?: number;
  type: string;
  description: string;
}

export interface Computer {
  id: number;
  name: string;
  /** Generated when `name` is blank (case/GPU, or Unnamed + a part). */
  displayName?: string | null;
  description?: string | null;
  type: 'PC' | 'Parts';
  status: string;
  addedDate: string;
  addedUserId?: string | null;
  addedUserName?: string | null;
  builderUserId?: string | null;
  builderName?: string | null;
  location?: string | null;
  price?: number | null;
  tax?: number | null;
  originalPrice?: number | null;
  bulkDesc?: string | null;
  bulkCost?: number | null;
  soldDate?: string | null;
  customerName?: string | null;
  customerUrl?: string | null;
  conversationUrl?: string | null;
  customerInfo?: string | null;
  customerAddress1?: string | null;
  customerAddress2?: string | null;
  customerCity?: string | null;
  customerState?: string | null;
  customerZip?: string | null;
  trackingNumber?: string | null;
  trackingStatus?: string | null;
  notes?: string | null;
  expectedCompletionDate?: string | null;
  ignoreIncomplete?: boolean;
  partsCost?: number;
  netPaid?: number;
  paymentFees?: number;
  hasDeposit?: boolean;
  hasPayment?: boolean;
  profit?: number;
  wagesBranden?: number;
  wagesJosh?: number;
  profitBen?: number;
  /** Wages paid to anyone except Josh. */
  wagesNonJosh?: number;
  /** Josh's total share percentage; null when he has no share. */
  joshSharePercentage?: number | null;
  /** Profit − all wages + wages paid to Ben L. */
  benProfit?: number;
  isShipping?: boolean;
  missingRequiredTypes?: string[];
  /** True when at least one assigned part's location differs from the computer location. */
  hasWrongLocationParts?: boolean;
  /** Profit after subtracting wages paid to builders who are not share recipients. */
  shareBase?: number;
  parts: Part[];
  placeholders?: PartPlaceholder[];
  payments: Payment[];
  wages?: Wage[];
  shares?: ComputerShare[];
}

export interface PartType {
  type: string;
  required: boolean;
}

export interface UserRef {
  id: string;
  name: string;
}

export interface Lookups {
  types: PartType[];
  sellers: string[];
  cpuSockets: string[];
  pcieGens: string[];
  ramTypes: string[];
  locations: string[];
  conditions: string[];
  users: UserRef[];
}

export interface PublicComputer {
  name: string;
  expectedCompletionDate?: string | null;
  parts: { type: string; manufacturer?: string; modelNumber?: string; color?: string; hasRgb: boolean }[];
}

/** Lower-permission Builds page DTOs (no pricing). */
export interface BuildPartSummary {
  id: number;
  type: string;
  manufacturer?: string | null;
  modelNumber?: string | null;
  color?: string | null;
  location?: string | null;
  received?: boolean;
}

export interface BuildPlaceholderSummary {
  id: number;
  type: string;
  description: string;
}

export interface BuildNote {
  id: number;
  computerId: number;
  userId: string;
  userName: string;
  text: string;
  createdDate: string;
}

export interface BuildSummary {
  id: number;
  name: string;
  status: string;
  builderUserId?: string | null;
  builderName?: string | null;
  /** Computer.Location — parts should match this when set. */
  location?: string | null;
  /** Computer.Notes */
  computerNotes?: string | null;
  parts: BuildPartSummary[];
  placeholders?: BuildPlaceholderSummary[];
  /** BuildNotes shown on list cards / detail. */
  comments?: BuildNote[];
}

export interface BuildDetail extends BuildSummary {
  /** Computer.Notes (inventory/build notes from the computer record). */
  computerNotes?: string | null;
  /**
   * Per-user build comments (BuildNotes table).
   * Detail endpoint historically used `notes`; list uses `comments`.
   */
  notes: BuildNote[];
}

/** Unassigned part row for Builds replace pickers (no cost). */
export interface BuildUnassignedPart {
  id: number;
  type: string;
  manufacturer?: string | null;
  modelNumber?: string | null;
  color?: string | null;
  location?: string | null;
  orderUrl?: string | null;
  received: boolean;
  condition?: string | null;
  testedDate?: string | null;
  /** Set when the part is currently on a Planned computer (includePlanned lists only). */
  computerId?: number | null;
  computerName?: string | null;
}

export const STATUSES = ['Planned', 'In-progress', 'Built', 'Active', 'Sold', 'Returned', 'Needs repair', 'Traded', 'Personal'];
export const PAYMENT_TYPES = ['payment', 'deposit', 'refund'];
export const PAYMENT_METHODS = ['cash', 'PayPal', 'Venmo', 'Zelle', 'CashApp', 'check', 'other'];

export interface MonthlySaleWage {
  id: number;
  builderUserId: string;
  amount: number;
  paidDate?: string | null;
  paidMethod?: string | null;
  notes?: string | null;
}

export interface MonthlySaleLine {
  id: number;
  name: string;
  soldDate?: string | null;
  customerName?: string | null;
  price: number;
  tax: number;
  isExempt: boolean;
  beforeTax: number;
  partsCost: number;
  paymentFees?: number;
  wagesTotal: number;
  wages: MonthlySaleWage[];
  profit: number;
}

export interface MonthlySummaryRow {
  month: number;
  monthName: string;
  soldCount: number;
  totalSales: number;
  exemptSales: number;
  totalBeforeTax: number;
  taxDue: number;
  partsCost: number;
  wages: number;
  profit: number;
  sales: MonthlySaleLine[];
}

export interface MonthlySummaryTotals {
  soldCount: number;
  totalSales: number;
  exemptSales: number;
  totalBeforeTax: number;
  taxDue: number;
  partsCost: number;
  wages: number;
  profit: number;
}

export interface MonthlySummaryReport {
  year: number;
  wagesBySaleDate?: boolean;
  availableYears: number[];
  months: MonthlySummaryRow[];
  yearTotals: MonthlySummaryTotals;
}

// ---------- Messenger bridge ----------

/** One entry in the last-message preview inside a thread list row. */
export interface MessengerLastMessage {
  direction: 'incoming' | 'outgoing';
  text: string;
  timestamp: string;
}

/** Summary row returned by GET /api/messenger/threads. */
export interface MessengerThread {
  id: number;
  fbThreadId: string;
  counterpartyName?: string | null;
  counterpartyUrl?: string | null;
  listingTitle?: string | null;
  listingUrl?: string | null;
  computerId?: number | null;
  lastMessageDate?: string | null;
  unread: boolean;
  lastMessage?: MessengerLastMessage | null;
  /** How many replies are queued/in-flight for this thread. */
  pendingReplies: number;
}

/** Attachment metadata (bytes are streamed from the API on demand). */
export interface MessengerAttachmentMeta {
  id: number;
  contentType: string;
  width?: number | null;
  height?: number | null;
}

/** A single message inside a thread transcript. */
export interface MessengerMessage {
  id: number;
  direction: 'incoming' | 'outgoing';
  senderName?: string | null;
  text: string;
  timestamp: string;
  attachments?: MessengerAttachmentMeta[];
}

export type MessengerRuleMatchType = 'contains' | 'equals' | 'regex' | 'any';

/** Auto-responder rule (matched against the newest incoming message). */
export interface MessengerRule {
  id: number;
  name: string;
  enabled: boolean;
  matchType: MessengerRuleMatchType;
  matchText?: string | null;
  responseText: string;
  orderIndex: number;
  cooldownMinutes: number;
  requireLinkedBuild: boolean;
  createdDate?: string;
  lastFiredDate?: string | null;
}
