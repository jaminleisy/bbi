import { booleanAttribute, Component, Input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/** Puzzle-piece + question mark: computer is missing required parts. */
@Component({
  selector: 'app-missing-parts-icon',
  standalone: true,
  imports: [MatIconModule],
  template: `
    <mat-icon class="base" aria-hidden="true">extension</mat-icon>
    <mat-icon class="mark" aria-hidden="true">question_mark</mat-icon>
  `,
  styles: [`
    :host {
      position: relative;
      display: inline-block;
      width: 1em;
      height: 1em;
      font-size: 20px;
      color: #d32f2f;
      vertical-align: middle;
      line-height: 0;
      flex-shrink: 0;
    }
    :host.compact { font-size: 18px; }
    .base, .mark {
      display: block;
      position: absolute;
    }
    .base {
      inset: 0;
      font-size: 1em;
      width: 1em;
      height: 1em;
    }
    /* Sit in the puzzle body (not the top-right nub). */
    .mark {
      font-size: 0.46em;
      width: 0.46em;
      height: 0.46em;
      left: 0.20em;
      top: 0.34em;
      color: #fff;
      font-weight: 700;
    }
  `],
  host: {
    '[class.compact]': 'compact',
    '[attr.aria-hidden]': 'true'
  }
})
export class MissingPartsIconComponent {
  @Input({ transform: booleanAttribute }) compact = false;
}
