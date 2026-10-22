import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiService } from '../../services/api.service';
import { PublicComputer } from '../../models';
import { partModelText } from '../../part-display';

@Component({
  selector: 'app-public-build',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="public-wrapper">
      @if (loading) {
        <mat-spinner></mat-spinner>
      } @else if (notFound) {
        <mat-card class="build-card">
          <mat-card-content style="text-align:center;padding:32px">
            <mat-icon style="font-size:48px;height:48px;width:48px;color:#999">search_off</mat-icon>
            <h2>Build not found</h2>
          </mat-card-content>
        </mat-card>
      } @else if (build) {
        <mat-card class="build-card">
          <mat-card-header>
            <mat-card-title style="font-size:28px">
              <mat-icon style="vertical-align:middle;margin-right:8px">computer</mat-icon>
              {{ build.name }}
            </mat-card-title>
            @if (build.expectedCompletionDate) {
              <mat-card-subtitle style="margin-top:8px">
                Expected completion: {{ build.expectedCompletionDate | date:'longDate' }}
              </mat-card-subtitle>
            }
          </mat-card-header>
          <mat-card-content>
            <h3 style="margin-top:24px">Parts List</h3>
            @if (build.parts.length) {
              <div class="parts-table-wrap">
              <table class="parts-table">
                <tr><th>Type</th><th>Manufacturer</th><th>Model</th><th>RGB</th></tr>
                @for (p of build.parts; track $index) {
                  <tr>
                    <td>{{ p.type }}</td>
                    <td>{{ p.manufacturer }}</td>
                    <td>{{ partModelText(p) }}</td>
                    <td>{{ p.hasRgb ? '✨ Yes' : '—' }}</td>
                  </tr>
                }
              </table>
              </div>
            } @else {
              <p style="color:#777">Parts have not been added to this build yet.</p>
            }
          </mat-card-content>
        </mat-card>
      }
    </div>
  `,
  styles: [`
    .public-wrapper {
      display: flex; justify-content: center; align-items: flex-start;
      min-height: 100vh; padding: 16px;
      box-sizing: border-box;
      background: linear-gradient(135deg, #1a237e, #0d47a1);
    }
    .build-card { width: 100%; max-width: 760px; padding: 12px; box-sizing: border-box; }
    .parts-table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    .parts-table { border-collapse: collapse; width: 100%; min-width: 420px; }
    .parts-table th, .parts-table td {
      text-align: left; padding: 8px 12px 8px 0; border-bottom: 1px solid #eee;
      font-size: 14px;
    }
    .parts-table th { color: #555; font-weight: 500; }
    @media (min-width: 600px) {
      .public-wrapper { padding: 32px 16px; }
      .build-card { padding: 16px; }
    }
  `]
})
export class PublicBuildComponent implements OnInit {
  partModelText = partModelText;
  build: PublicComputer | null = null;
  loading = true;
  notFound = false;

  constructor(private route: ActivatedRoute, private api: ApiService) {}

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.api.getPublicComputer(id).subscribe({
      next: build => { this.build = build; this.loading = false; },
      error: () => { this.notFound = true; this.loading = false; }
    });
  }
}
