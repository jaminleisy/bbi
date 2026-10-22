import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  BuildDetail, BuildNote, BuildSummary, BuildUnassignedPart, Computer, Lookups,
  CheckOffTestOutcome, MessengerMessage, MessengerRule, MessengerThread,
  MonthlySummaryReport, Part, PartImageMeta, PartPlaceholder, PartType, Payment,
  PublicComputer, Wage, ComputerShare
} from '../models';

export interface AdminUser {
  id: string;
  name: string;
  permissionLevel: number;
  buildAccess?: string | null;
}

export interface ParsedPartDraft {
  type?: string | null;
  manufacturer?: string | null;
  modelNumber?: string | null;
  cost?: number | null;
  orderDate?: string | null;
  orderUrl?: string | null;
  seller?: string | null;
  condition?: string | null;
  location?: string | null;
  color?: string | null;
  merchant?: string | null;
  notes?: string | null;
  quantity?: number;
  orderId?: string | null;
  sourceFileName?: string | null;
  /** data:image/...;base64,... for review UI only */
  imageDataUrl?: string | null;
  /** True when this order id already appears in an existing part's OrderUrl */
  isDuplicate?: boolean;
}

export interface ParseOrderPdfFileResult {
  fileName: string;
  ok: boolean;
  error?: string | null;
  drafts: ParsedPartDraft[];
}

export interface ParseOrderPdfsResponse {
  files: ParseOrderPdfFileResult[];
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private api = environment.apiUrl;

  constructor(private http: HttpClient) {}

  // ----- Lookups -----
  getLookups(): Observable<Lookups> {
    return this.http.get<Lookups>(`${this.api}/lookups`);
  }

  addLookupValue(kind: 'sellers' | 'cpu-sockets' | 'pcie-gens' | 'ram-types' | 'locations' | 'conditions', name: string) {
    return this.http.post(`${this.api}/lookups/${kind}`, { name });
  }

  // ----- Parts -----
  getParts(filters: Record<string, string | boolean | undefined> = {}): Observable<Part[]> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    }
    return this.http.get<Part[]>(`${this.api}/parts`, { params });
  }

  getPart(id: number): Observable<Part> {
    return this.http.get<Part>(`${this.api}/parts/${id}`);
  }

  createPart(part: Partial<Part>): Observable<Part> {
    return this.http.post<Part>(`${this.api}/parts`, part);
  }

  parseOrderPdfs(files: File[]): Observable<ParseOrderPdfsResponse> {
    const form = new FormData();
    for (const f of files) {
      form.append('files', f, f.name);
    }
    return this.http.post<ParseOrderPdfsResponse>(`${this.api}/parts/parse-order-pdfs`, form);
  }

  importParsedParts(parts: Array<Partial<Part> & { imageDataUrl?: string | null }>): Observable<Part[]> {
    return this.http.post<Part[]>(`${this.api}/parts/import-parsed`, { parts });
  }

  updatePart(id: number, part: Partial<Part>): Observable<Part> {
    return this.http.put<Part>(`${this.api}/parts/${id}`, part);
  }

  splitPart(id: number, quantity: number, modelNumber: string): Observable<Part[]> {
    return this.http.post<Part[]>(`${this.api}/parts/${id}/split`, { quantity, modelNumber });
  }

  deletePart(id: number) {
    return this.http.delete(`${this.api}/parts/${id}`);
  }

  markReceived(id: number, received: boolean, appearsUsed = false) {
    return this.http.post(`${this.api}/parts/${id}/received`, { received, appearsUsed });
  }

  markTested(id: number, tested: boolean) {
    return this.http.post<{ id: number; testedDate: string | null; testedUserId: string | null }>(
      `${this.api}/parts/${id}/tested`,
      { tested }
    );
  }

  checkOffTest(id: number, outcome: CheckOffTestOutcome, notes?: string | null) {
    return this.http.post(`${this.api}/parts/${id}/check-off/test`, { outcome, notes });
  }

  listPartImages(partId: number): Observable<PartImageMeta[]> {
    return this.http.get<PartImageMeta[]>(`${this.api}/parts/${partId}/images`);
  }

  partImageUrl(partId: number, imageId: number): string {
    return `${this.api}/parts/${partId}/images/${imageId}`;
  }

  uploadPartImage(partId: number, file: File, source?: 'import' | 'receiving' | 'testing' | null): Observable<PartImageMeta> {
    const form = new FormData();
    form.append('file', file, file.name);
    if (source) form.append('source', source);
    return this.http.post<PartImageMeta>(`${this.api}/parts/${partId}/images`, form);
  }

  deletePartImage(partId: number, imageId: number) {
    return this.http.delete(`${this.api}/parts/${partId}/images/${imageId}`);
  }

  setPartLocation(id: number, name: string) {
    return this.http.post(`${this.api}/parts/${id}/location`, { name });
  }

  setPartCondition(id: number, name: string) {
    return this.http.post(`${this.api}/parts/${id}/condition`, { name });
  }

  // ----- Computers -----
  getComputers(filters: Record<string, string | number | boolean | undefined> = {}): Observable<Computer[]> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    }
    return this.http.get<Computer[]>(`${this.api}/computers`, { params });
  }

  getComputer(id: number): Observable<Computer> {
    return this.http.get<Computer>(`${this.api}/computers/${id}`);
  }

  getPublicComputer(id: number): Observable<PublicComputer> {
    return this.http.get<PublicComputer>(`${this.api}/computers/${id}/public`);
  }

  createComputer(computer: Partial<Computer>): Observable<Computer> {
    return this.http.post<Computer>(`${this.api}/computers`, computer);
  }

  updateComputer(id: number, computer: Partial<Computer>): Observable<Computer> {
    return this.http.put<Computer>(`${this.api}/computers/${id}`, computer);
  }

  setComputerStatus(id: number, name: string) {
    return this.http.post<{ status: string; soldDate?: string | null }>(`${this.api}/computers/${id}/status`, { name });
  }

  setComputerLocation(id: number, name: string) {
    return this.http.post(`${this.api}/computers/${id}/location`, { name });
  }

  setComputerBuilder(id: number, name: string) {
    return this.http.post<{ builderUserId: string | null; builderName: string | null }>(
      `${this.api}/computers/${id}/builder`, { name });
  }

  setComputerPrice(id: number, price: number | null) {
    return this.http.post<{ price: number | null; tax: number | null }>(
      `${this.api}/computers/${id}/price`,
      { price }
    );
  }

  deleteComputer(id: number) {
    return this.http.delete(`${this.api}/computers/${id}`);
  }

  assignParts(computerId: number, partIds: number[]) {
    return this.http.post(`${this.api}/computers/${computerId}/parts`, { partIds });
  }

  addComputerPlaceholder(computerId: number, type: string, description: string): Observable<PartPlaceholder> {
    return this.http.post<PartPlaceholder>(`${this.api}/computers/${computerId}/placeholders`, { type, description });
  }

  updateComputerPlaceholder(computerId: number, phId: number, type: string, description: string): Observable<PartPlaceholder> {
    return this.http.put<PartPlaceholder>(`${this.api}/computers/${computerId}/placeholders/${phId}`, { type, description });
  }

  deleteComputerPlaceholder(computerId: number, phId: number) {
    return this.http.delete(`${this.api}/computers/${computerId}/placeholders/${phId}`);
  }

  replaceComputerPlaceholder(computerId: number, phId: number, partId: number) {
    return this.http.post(`${this.api}/computers/${computerId}/placeholders/${phId}/replace`, { partId });
  }

  replaceComputerPartWithPlaceholder(computerId: number, partId: number, description: string): Observable<PartPlaceholder> {
    return this.http.post<PartPlaceholder>(
      `${this.api}/computers/${computerId}/parts/${partId}/replace-with-placeholder`, { description });
  }

  replaceComputerPartWithPart(computerId: number, partId: number, newPartId: number) {
    return this.http.post(`${this.api}/computers/${computerId}/parts/${partId}/replace-with-part`, { newPartId });
  }

  addPayment(
    computerId: number,
    payment: Partial<Payment> & {
      customerName?: string | null;
      customerUrl?: string | null;
      conversationUrl?: string | null;
    }
  ): Observable<Payment> {
    return this.http.post<Payment>(`${this.api}/computers/${computerId}/payments`, payment);
  }

  deletePayment(computerId: number, paymentId: number) {
    return this.http.delete(`${this.api}/computers/${computerId}/payments/${paymentId}`);
  }

  // ----- Wages -----
  createWage(wage: Partial<Wage>): Observable<Wage> {
    return this.http.post<Wage>(`${this.api}/wages`, wage);
  }

  updateWage(id: number, wage: Partial<Wage>): Observable<Wage> {
    return this.http.put<Wage>(`${this.api}/wages/${id}`, wage);
  }

  deleteWage(id: number) {
    return this.http.delete(`${this.api}/wages/${id}`);
  }

  // ----- Computer shares -----
  createShare(share: Partial<ComputerShare>): Observable<ComputerShare> {
    return this.http.post<ComputerShare>(`${this.api}/shares`, share);
  }

  updateShare(id: number, share: Partial<ComputerShare>): Observable<ComputerShare> {
    return this.http.put<ComputerShare>(`${this.api}/shares/${id}`, share);
  }

  deleteShare(id: number) {
    return this.http.delete(`${this.api}/shares/${id}`);
  }

  // ----- Builds (lower-permission, scoped by BuildAccess) -----
  getBuilds(): Observable<BuildSummary[]> {
    return this.http.get<BuildSummary[]>(`${this.api}/builds`);
  }

  getBuild(id: number): Observable<BuildDetail> {
    return this.http.get<BuildDetail>(`${this.api}/builds/${id}`);
  }

  getBuildPartTypes(): Observable<PartType[]> {
    return this.http.get<PartType[]>(`${this.api}/builds/part-types`);
  }

  getBuildUnassignedParts(type?: string, includePlanned = false): Observable<BuildUnassignedPart[]> {
    let params = new HttpParams();
    if (type) params = params.set('type', type);
    if (includePlanned) params = params.set('includePlanned', 'true');
    return this.http.get<BuildUnassignedPart[]>(`${this.api}/builds/unassigned-parts`, { params });
  }

  addBuildNote(id: number, text: string): Observable<BuildNote> {
    return this.http.post<BuildNote>(`${this.api}/builds/${id}/notes`, { text });
  }

  setBuildComputerNotes(buildId: number, notes: string | null) {
    return this.http.put<{ computerNotes: string | null }>(
      `${this.api}/builds/${buildId}/computer-notes`, { notes });
  }

  addBuildPlaceholder(buildId: number, type: string, description: string): Observable<PartPlaceholder> {
    return this.http.post<PartPlaceholder>(`${this.api}/builds/${buildId}/placeholders`, { type, description });
  }

  updateBuildPlaceholder(buildId: number, phId: number, type: string, description: string): Observable<PartPlaceholder> {
    return this.http.put<PartPlaceholder>(`${this.api}/builds/${buildId}/placeholders/${phId}`, { type, description });
  }

  deleteBuildPlaceholder(buildId: number, phId: number) {
    return this.http.delete(`${this.api}/builds/${buildId}/placeholders/${phId}`);
  }

  replaceBuildPlaceholder(buildId: number, phId: number, partId: number) {
    return this.http.post(`${this.api}/builds/${buildId}/placeholders/${phId}/replace`, { partId });
  }

  replaceBuildPartWithPlaceholder(buildId: number, partId: number, description: string): Observable<PartPlaceholder> {
    return this.http.post<PartPlaceholder>(
      `${this.api}/builds/${buildId}/parts/${partId}/replace-with-placeholder`, { description });
  }

  replaceBuildPartWithPart(buildId: number, partId: number, newPartId: number) {
    return this.http.post(`${this.api}/builds/${buildId}/parts/${partId}/replace-with-part`, { newPartId });
  }

  setBuildStatus(buildId: number, status: string) {
    return this.http.post<{ status: string; soldDate?: string | null }>(
      `${this.api}/builds/${buildId}/status`, { status });
  }

  setBuildBuilder(buildId: number, builderUserId: string | null) {
    return this.http.post<{ builderUserId: string | null; builderName: string | null }>(
      `${this.api}/builds/${buildId}/builder`, { builderUserId });
  }

  // ----- Users (permission level 3) -----
  getUsers(): Observable<AdminUser[]> {
    return this.http.get<AdminUser[]>(`${this.api}/users`);
  }

  createUser(user: { userId: string; password: string; name: string; permissionLevel: number; buildAccess?: string | null }) {
    return this.http.post(`${this.api}/users`, user);
  }

  updateUser(id: string, user: { name: string; permissionLevel: number; buildAccess?: string | null }) {
    return this.http.put(`${this.api}/users/${encodeURIComponent(id)}`, user);
  }

  setUserPassword(id: string, newPassword: string) {
    return this.http.post(`${this.api}/users/${encodeURIComponent(id)}/password`, { newPassword });
  }

  // ----- Reports -----
  getMonthlySummary(year?: number, wagesBySaleDate = false): Observable<MonthlySummaryReport> {
    let params = new HttpParams();
    if (year != null) params = params.set('year', String(year));
    if (wagesBySaleDate) params = params.set('wagesBySaleDate', 'true');
    return this.http.get<MonthlySummaryReport>(`${this.api}/reports/monthly`, { params });
  }

  // ----- Messenger bridge -----
  getMessengerThreads(unreadOnly = false): Observable<MessengerThread[]> {
    let params = new HttpParams();
    if (unreadOnly) params = params.set('unreadOnly', 'true');
    return this.http.get<MessengerThread[]>(`${this.api}/messenger/threads`, { params });
  }

  getMessengerMessages(threadId: number): Observable<MessengerMessage[]> {
    return this.http.get<MessengerMessage[]>(`${this.api}/messenger/threads/${threadId}/messages`);
  }

  queueMessengerReply(threadId: number, text: string): Observable<{ id: number; status: string }> {
    return this.http.post<{ id: number; status: string }>(
      `${this.api}/messenger/threads/${threadId}/reply`, { text });
  }

  markMessengerRead(threadId: number) {
    return this.http.post(`${this.api}/messenger/threads/${threadId}/read`, {});
  }

  /** Body is a raw JSON number (or null to unlink). Matches [FromBody] int? on the server. */
  linkMessengerThreadToComputer(threadId: number, computerId: number | null) {
    return this.http.post(`${this.api}/messenger/threads/${threadId}/link`, computerId);
  }

  getMessengerUnreadCount(): Observable<{ count: number }> {
    return this.http.get<{ count: number }>(`${this.api}/messenger/unread-count`);
  }

  /** URL of an attachment blob — set as an <img src>. */
  messengerAttachmentUrl(attachmentId: number): string {
    return `${this.api}/messenger/attachments/${attachmentId}`;
  }

  // ----- Messenger auto-responder rules -----
  getMessengerRules(): Observable<MessengerRule[]> {
    return this.http.get<MessengerRule[]>(`${this.api}/messenger/rules`);
  }

  createMessengerRule(rule: Partial<MessengerRule>): Observable<MessengerRule> {
    return this.http.post<MessengerRule>(`${this.api}/messenger/rules`, rule);
  }

  updateMessengerRule(id: number, rule: Partial<MessengerRule>): Observable<MessengerRule> {
    return this.http.put<MessengerRule>(`${this.api}/messenger/rules/${id}`, rule);
  }

  deleteMessengerRule(id: number) {
    return this.http.delete(`${this.api}/messenger/rules/${id}`);
  }

  testMessengerRuleMatch(rule: Partial<MessengerRule>, text: string): Observable<{ matches: boolean }> {
    return this.http.post<{ matches: boolean }>(
      `${this.api}/messenger/rules/test-match`, { rule, text });
  }
}
