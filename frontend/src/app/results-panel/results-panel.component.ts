import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ChartModule } from 'primeng/chart';
import { TableModule } from 'primeng/table';
import { SkeletonModule } from 'primeng/skeleton';
import type { ChartConfiguration, ScriptableContext } from 'chart.js';
import { MetricsStore } from '../metrics.store';
import { ThemeService } from '../theme.service';
import { I18nService } from '../i18n/i18n.service';
import { LanguageSelectorComponent } from '../i18n/language-selector.component';
import { ChartExportService } from '../chart-export.service';
import { formatDate } from '../format.util';

type ViewMode = 'chart' | 'table';

interface TableRow {
  date: string;
  dow: string;
  isWeekend: boolean;
  value: number;
}

const DOW_KEYS = [
  'results.dow.sun',
  'results.dow.mon',
  'results.dow.tue',
  'results.dow.wed',
  'results.dow.thu',
  'results.dow.fri',
  'results.dow.sat',
];

/**
 * Formata `YYYY-MM-DD` pra label de eixo conforme granularidade e idioma.
 * Parse manual evita off-by-one do `new Date('YYYY-MM-DD')` em timezone
 * negativo. Abreviacoes de mes vem do `Intl.DateTimeFormat` no BCP47.
 */
function formatAxisLabel(
  iso: string,
  gran: 'DAY' | 'MONTH' | 'YEAR',
  bcp47: string,
): string {
  const [y, m, d] = iso.split('-');
  const date = new Date(+y, +m - 1, +d);
  switch (gran) {
    case 'DAY':
      return date.toLocaleDateString(bcp47, {
        day: '2-digit',
        month: '2-digit',
      });
    case 'MONTH': {
      const short = date
        .toLocaleDateString(bcp47, { month: 'short' })
        .replace('.', '');
      return `${short}/${y.slice(2)}`;
    }
    case 'YEAR':
      return y;
  }
}

function isoToDow(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

@Component({
  selector: 'app-results-panel',
  standalone: true,
  imports: [
    CommonModule,
    ChartModule,
    TableModule,
    SkeletonModule,
    LanguageSelectorComponent,
  ],
  template: `
    <section class="results" aria-labelledby="results-title">
      <!-- Header -->
      <header class="r-head">
        <div class="r-title">
          <h1 id="results-title">
            {{ i18n.t('results.title') }}
            @if (store.searched() && !store.loading() && pointsCount() > 0) {
              <span class="badge">
                <i class="badge-dot" aria-hidden="true"></i>
                {{ pointsLabel() }}
              </span>
            }
          </h1>
          <span class="r-sub">
            @if (store.searched() && store.isFormValid()) {
              {{ headerInfo() }}
            } @else {
              {{ i18n.t('results.header.prompt') }}
            }
          </span>
        </div>

        <div class="r-actions">
          <div
            class="seg-sm"
            role="tablist"
            [attr.aria-label]="i18n.t('results.view.aria')"
          >
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="viewMode() === 'chart'"
              [class.on]="viewMode() === 'chart'"
              (click)="setView('chart')"
            >
              <i class="pi pi-chart-line" aria-hidden="true"></i>
              <span>{{ i18n.t('results.view.chart') }}</span>
            </button>
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="viewMode() === 'table'"
              [class.on]="viewMode() === 'table'"
              (click)="setView('table')"
            >
              <i class="pi pi-table" aria-hidden="true"></i>
              <span>{{ i18n.t('results.view.table') }}</span>
            </button>
          </div>

          <app-language-selector />

          <button
            type="button"
            class="theme-btn"
            (click)="theme.toggle()"
            [attr.aria-label]="
              theme.theme() === 'dark'
                ? i18n.t('header.theme.toLight')
                : i18n.t('header.theme.toDark')
            "
            [attr.title]="
              theme.theme() === 'dark'
                ? i18n.t('header.theme.light')
                : i18n.t('header.theme.dark')
            "
          >
            <i
              class="pi"
              [class.pi-sun]="theme.theme() === 'dark'"
              [class.pi-moon]="theme.theme() === 'light'"
              aria-hidden="true"
            ></i>
          </button>
        </div>
      </header>

      <!-- Stale banner: aparece quando os resultados em tela foram
           gerados por um formulario/arquivo diferente do atual. -->
      @if (store.isStale()) {
        <div class="stale-banner" role="status">
          <span class="stale-ico"><i class="pi pi-exclamation-triangle" aria-hidden="true"></i></span>
          <div class="stale-msg">
            <strong>{{ i18n.t('results.stale.title') }}</strong>
            <span>{{ i18n.t('results.stale.message') }}</span>
          </div>
          <button
            type="button"
            class="stale-action"
            (click)="store.consultar()"
            [disabled]="!store.isSubmittable()"
          >
            <i class="pi pi-refresh" aria-hidden="true"></i>
            {{ i18n.t('results.stale.action') }}
          </button>
        </div>
      }

      <!-- KPIs -->
      <div class="kpis" aria-live="polite">
        <div class="kpi hero">
          <div class="kpi-head">
            <span class="kpi-label">{{ i18n.t('results.kpi.total') }}</span>
            <span class="kpi-sym" aria-hidden="true">
              <i class="pi pi-chart-bar"></i>
            </span>
          </div>
          @if (store.loading()) {
            <p-skeleton width="7rem" height="1.8rem" />
          } @else if (hasData()) {
            <span class="kpi-value">{{ store.total() | number }}</span>
          } @else {
            <span class="kpi-value">—</span>
          }
        </div>
        <div class="kpi">
          <div class="kpi-head">
            <span class="kpi-label">{{ i18n.t('results.kpi.avg') }}</span>
            <span class="kpi-sym" aria-hidden="true">
              <i class="pi pi-chart-line"></i>
            </span>
          </div>
          @if (store.loading()) {
            <p-skeleton width="5rem" height="1.6rem" />
          } @else if (hasData()) {
            <span class="kpi-value">{{ store.kpis().avg | number }}</span>
          } @else {
            <span class="kpi-value">—</span>
          }
        </div>
        <div class="kpi">
          <div class="kpi-head">
            <span class="kpi-label">{{ i18n.t('results.kpi.max') }}</span>
            <span class="kpi-sym" aria-hidden="true">
              <i class="pi pi-arrow-up"></i>
            </span>
          </div>
          @if (store.loading()) {
            <p-skeleton width="5rem" height="1.6rem" />
          } @else if (hasData()) {
            <span class="kpi-value">{{ store.kpis().max | number }}</span>
            @if (store.kpis().maxDate) {
              <span class="kpi-footer">{{ store.kpis().maxDate }}</span>
            }
          } @else {
            <span class="kpi-value">—</span>
          }
        </div>
        <div class="kpi">
          <div class="kpi-head">
            <span class="kpi-label">{{ i18n.t('results.kpi.min') }}</span>
            <span class="kpi-sym" aria-hidden="true">
              <i class="pi pi-arrow-down"></i>
            </span>
          </div>
          @if (store.loading()) {
            <p-skeleton width="5rem" height="1.6rem" />
          } @else if (hasData()) {
            <span class="kpi-value muted">{{ store.kpis().min | number }}</span>
            @if (store.kpis().minDate) {
              <span class="kpi-footer">{{ store.kpis().minDate }}</span>
            }
          } @else {
            <span class="kpi-value muted">—</span>
          }
        </div>
      </div>

      <!-- Body -->
      <div class="body" aria-live="polite">
        @if (showInitial()) {
          <div class="empty muted">
            <i class="pi pi-sliders-h" aria-hidden="true"></i>
            <p>{{ i18n.t('results.empty.initial') }}</p>
          </div>
        } @else if (showEmpty()) {
          <div class="empty">
            <i class="pi pi-inbox" aria-hidden="true"></i>
            <p>{{ i18n.t('results.empty.noData') }}</p>
          </div>
        } @else if (viewMode() === 'chart') {
          <!-- Chart principal -->
          <div class="chart-card chart-main">
            <div class="cc-head">
              <div class="cc-title">
                <span class="cc-ico"><i class="pi pi-chart-line" aria-hidden="true"></i></span>
                {{ i18n.t('results.chart.main.title') }}
              </div>
              <div class="cc-meta">
                <span class="cc-sub">{{ i18n.t('results.chart.main.subtitle') }}</span>
                <button
                  type="button"
                  class="cc-png"
                  (click)="exportOne('main')"
                  [attr.aria-label]="i18n.t('results.exportPng.aria')"
                  [attr.title]="i18n.t('results.exportPng.title')"
                >
                  <i class="pi pi-download" aria-hidden="true"></i>PNG
                </button>
              </div>
            </div>
            <div class="cc-canvas">
              @if (store.loading()) {
                <p-skeleton width="100%" height="100%" styleClass="chart-skel" />
              } @else {
                <p-chart
                  type="line"
                  [data]="mainChartData()"
                  [options]="mainChartOptions()"
                />
              }
            </div>
          </div>

          <!-- Sub row: distribuição + weekday -->
          <div class="sub-row">
            <div class="chart-card chart-dist">
              <div class="cc-head">
                <div class="cc-title">
                  <span class="cc-ico"><i class="pi pi-chart-bar" aria-hidden="true"></i></span>
                  {{ i18n.t('results.chart.dist.title') }}
                </div>
                <div class="cc-meta">
                  <span class="cc-sub">{{ i18n.t('results.chart.dist.subtitle') }}</span>
                  <button
                    type="button"
                    class="cc-icn"
                    [attr.data-tooltip]="i18n.t('results.exportPng.title')"
                    [attr.aria-label]="i18n.t('results.exportPng.aria')"
                    (click)="exportOne('dist')"
                  >
                    <i class="pi pi-download" aria-hidden="true"></i>
                  </button>
                </div>
              </div>
              <div class="cc-canvas cc-canvas-sm">
                @if (store.loading()) {
                  <p-skeleton width="100%" height="100%" styleClass="chart-skel" />
                } @else {
                  @if (store.histogram(); as h) {
                    <p-chart type="bar" [data]="distData(h)" [options]="subOptions()" />
                  }
                }
              </div>
            </div>

            @if (store.weekdayMeans(); as dow) {
              <div class="chart-card chart-dow">
                <div class="cc-head">
                  <div class="cc-title">
                    <span class="cc-ico"><i class="pi pi-calendar" aria-hidden="true"></i></span>
                    {{ i18n.t('results.chart.dow.title') }}
                  </div>
                  <div class="cc-meta">
                    <span class="cc-sub">{{ i18n.t('results.chart.dow.subtitle') }}</span>
                    <button
                      type="button"
                      class="cc-icn"
                      [attr.data-tooltip]="i18n.t('results.exportPng.title')"
                      [attr.aria-label]="i18n.t('results.exportPng.aria')"
                      (click)="exportOne('dow')"
                    >
                      <i class="pi pi-download" aria-hidden="true"></i>
                    </button>
                  </div>
                </div>
                <div class="cc-canvas cc-canvas-sm">
                  <p-chart type="bar" [data]="dowData(dow)" [options]="subOptions()" />
                </div>
              </div>
            }
          </div>
        } @else {
          <!-- Table view -->
          <div class="chart-card chart-table">
            <div class="cc-head">
              <div class="cc-title">
                <span class="cc-ico"><i class="pi pi-table" aria-hidden="true"></i></span>
                {{ i18n.t('results.title') }}
              </div>
              <div class="cc-meta">
                <span class="cc-sub">
                  {{ i18n.t('results.table.info', {
                    from: tableFrom(), to: tableTo(), total: store.data().length
                  }) }}
                </span>
              </div>
            </div>
            <p-table
              [value]="store.loading() ? skeletonRows : tableRows()"
              [styleClass]="'gy-table' + (store.loading() ? ' is-loading' : '')"
              [paginator]="!store.loading() && tableRows().length > 12"
              [rows]="12"
              [tableStyle]="{ 'min-width': '320px' }"
              (onPage)="onPage($event)"
            >
              <ng-template pTemplate="header">
                <tr>
                  <th scope="col">{{ i18n.t('results.table.date') }}</th>
                  @if (showWeekdayColumn()) {
                    <th scope="col">{{ i18n.t('results.table.weekday') }}</th>
                  }
                  <th scope="col" class="right">{{ i18n.t('results.table.value') }}</th>
                </tr>
              </ng-template>
              <ng-template pTemplate="body" let-row>
                @if (store.loading()) {
                  <tr aria-hidden="true">
                    <td><p-skeleton width="7rem" height="0.95rem" /></td>
                    @if (showWeekdayColumn()) {
                      <td><p-skeleton width="4rem" height="0.95rem" /></td>
                    }
                    <td class="right">
                      <p-skeleton width="4rem" height="0.95rem" styleClass="ml-auto" />
                    </td>
                  </tr>
                } @else {
                  <tr>
                    <td class="mono">{{ row.date }}</td>
                    @if (showWeekdayColumn()) {
                      <td>
                        <span
                          class="dow-chip"
                          [class.weekend]="row.isWeekend"
                        >{{ row.dow }}</span>
                      </td>
                    }
                    <td class="right num">{{ row.value | number }}</td>
                  </tr>
                }
              </ng-template>
            </p-table>
          </div>
        }
      </div>
    </section>
  `,
  styles: [
    `
      :host { display: flex; flex: 1; min-width: 0; }

      .results {
        background: var(--gy-surface);
        border: 1px solid var(--gy-border);
        border-radius: 14px;
        padding: 1.25rem 1.3rem;
        box-shadow: var(--gy-shadow);
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      /* ========== Header ========== */
      .r-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 1rem;
        margin-bottom: 1.25rem;
        flex-wrap: wrap;
      }
      .r-title h1 {
        font-family: 'Nunito', sans-serif;
        font-size: 1.75rem;
        font-weight: 800;
        margin: 0;
        letter-spacing: -0.02em;
        display: inline-flex;
        align-items: center;
        gap: 0.6rem;
      }
      .r-title .badge {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        background: var(--gy-green-50);
        color: var(--gy-green-dark);
        padding: 0.28rem 0.65rem;
        border-radius: 999px;
        font-size: 0.7rem;
        font-weight: 700;
        margin-left: 0.5rem;
      }
      :root[data-theme='dark'] .r-title .badge { color: var(--gy-green); }
      .r-title .badge-dot {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: var(--gy-green);
      }
      .r-title .r-sub {
        display: block;
        font-family: 'JetBrains Mono', 'Nunito Sans', monospace;
        font-size: 0.78rem;
        color: var(--gy-text-soft);
        margin-top: 0.3rem;
      }

      .r-actions {
        display: flex;
        align-items: center;
        gap: 0.45rem;
      }
      .seg-sm {
        display: inline-flex;
        gap: 0.15rem;
        background: var(--gy-surface-2);
        border: 1px solid var(--gy-border);
        border-radius: 8px;
        padding: 0.22rem;
        height: 40px;
        align-items: stretch;
      }
      .seg-sm button {
        border: 0;
        background: transparent;
        padding: 0 0.8rem;
        border-radius: 6px;
        font: inherit;
        font-weight: 700;
        font-size: 0.78rem;
        color: var(--gy-text-soft);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
      }
      .seg-sm button.on {
        background: var(--gy-surface);
        color: var(--gy-text);
        box-shadow: 0 1px 2px rgba(16, 24, 40, 0.08);
      }
      :root[data-theme='dark'] .seg-sm button.on {
        background: var(--gy-surface);
        color: var(--gy-text);
      }
      .seg-sm button i { font-size: 0.82rem; }

      .theme-btn {
        width: 40px;
        height: 40px;
        display: grid;
        place-items: center;
        border-radius: 8px;
        border: 1px solid var(--gy-border);
        background: var(--gy-surface);
        color: var(--gy-text);
        cursor: pointer;
        transition: background 140ms, border-color 140ms, color 140ms;
      }
      .theme-btn:hover {
        background: var(--gy-green-50);
        border-color: var(--gy-green);
        color: var(--gy-green-dark);
      }
      :root[data-theme='dark'] .theme-btn:hover { color: var(--gy-green); }
      .theme-btn i { font-size: 1rem; }

      /* ========== Stale banner ========== */
      /* Sinaliza que os resultados em tela nao refletem o formulario
         atual. O KPI row + body ganham opacity reduzido pra reforcar
         sem esconder os dados (user pode querer comparar). */
      .stale-banner {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.7rem 0.95rem;
        margin-bottom: 1rem;
        border-radius: 10px;
        background:
          linear-gradient(90deg, rgba(252, 204, 29, 0.12), rgba(252, 204, 29, 0.04)),
          var(--gy-surface);
        border: 1px solid var(--gy-yellow);
        color: var(--gy-text);
        animation: gy-stale-in 220ms ease-out;
      }
      :root[data-theme='dark'] .stale-banner {
        background:
          linear-gradient(90deg, rgba(252, 204, 29, 0.1), rgba(252, 204, 29, 0.02)),
          var(--gy-surface);
      }
      @keyframes gy-stale-in {
        from { opacity: 0; transform: translateY(-4px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      .stale-ico {
        width: 32px; height: 32px;
        border-radius: 50%;
        background: var(--gy-yellow);
        color: #0B0B0B;
        display: grid; place-items: center;
        flex: 0 0 32px;
      }
      .stale-ico i { font-size: 0.95rem; }
      .stale-msg {
        flex: 1; display: flex; flex-direction: column; gap: 0.1rem;
        min-width: 0;
      }
      .stale-msg strong {
        font-family: 'Nunito', sans-serif;
        font-size: 0.85rem;
        font-weight: 800;
      }
      .stale-msg span {
        font-size: 0.78rem;
        color: var(--gy-text-soft);
      }
      .stale-action {
        display: inline-flex; align-items: center; gap: 0.3rem;
        background: var(--gy-green-dark);
        color: #fff;
        border: 0;
        padding: 0.5rem 0.85rem;
        border-radius: 8px;
        font: inherit;
        font-weight: 800;
        font-size: 0.8rem;
        cursor: pointer;
        transition: transform 120ms ease, box-shadow 120ms ease;
        flex: 0 0 auto;
      }
      :root[data-theme='dark'] .stale-action {
        background: var(--gy-green);
        color: var(--gy-bg);
      }
      .stale-action:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 4px 10px rgba(135, 188, 37, 0.3);
      }
      .stale-action:disabled { opacity: 0.45; cursor: not-allowed; }
      .stale-action i { font-size: 0.78rem; }

      /* ========== KPIs ========== */
      .kpis {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 0.85rem;
        margin-bottom: 1.1rem;
      }
      .kpi {
        background: var(--gy-surface-2);
        border: 1px solid var(--gy-border-soft);
        border-radius: 10px;
        padding: 1rem 1.15rem;
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
        min-height: 124px;
        transition: transform 150ms ease;
      }
      .kpi:hover { transform: translateY(-2px); }
      .kpi-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .kpi-label {
        font-size: 0.7rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--gy-text-soft);
      }
      .kpi-sym {
        width: 28px;
        height: 28px;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.65);
        display: grid;
        place-items: center;
        color: var(--gy-text-soft);
        border: 1px solid rgba(0, 0, 0, 0.04);
      }
      .kpi-sym i { font-size: 0.95rem; }
      /* Override dark-mode de .kpi-sym vive em styles.scss global
         pra fugir da view encapsulation do Angular. */
      .kpi-value {
        font-family: 'Nunito', sans-serif;
        font-weight: 800;
        font-size: 1.85rem;
        letter-spacing: -0.03em;
        line-height: 1;
        margin-top: 0.3rem;
        font-variant-numeric: tabular-nums;
      }
      .kpi-value.muted { color: var(--gy-text-soft); }
      .kpi-footer {
        font-family: 'JetBrains Mono', 'Nunito Sans', monospace;
        font-size: 0.74rem;
        color: var(--gy-text-soft);
        margin-top: auto;
      }

      /* KPI hero: gradiente lime da marca, primeiro card */
      .kpi.hero {
        background:
          radial-gradient(circle at 85% 15%, rgba(255, 255, 255, 0.4), transparent 40%),
          linear-gradient(135deg, #D7F14B 0%, #A4D330 55%, var(--gy-green) 100%);
        border-color: transparent;
        color: #1F3A0A;
      }
      .kpi.hero .kpi-label { color: rgba(31, 58, 10, 0.72); }
      .kpi.hero .kpi-sym {
        background: rgba(31, 58, 10, 0.92);
        color: #D7F14B;
        border-color: transparent;
      }
      .kpi.hero .kpi-value { color: #0B1F05; }

      @media (max-width: 640px) {
        .kpis { grid-template-columns: repeat(2, 1fr); }
      }

      /* ========== Body / chart cards ========== */
      .body {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
        min-height: 0;
      }
      .empty {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        padding: 2rem 1rem;
        text-align: center;
        background: var(--gy-surface-2);
        border: 1px dashed var(--gy-border);
        border-radius: 10px;
      }
      .empty i {
        font-size: 2.1rem;
        color: var(--gy-green);
        opacity: 0.8;
      }
      .empty.muted i {
        color: var(--gy-text-soft);
        opacity: 0.55;
      }
      .empty p {
        margin: 0;
        font-size: 0.9rem;
        color: var(--gy-text-soft);
        max-width: 32ch;
      }

      .chart-card {
        background: var(--gy-surface-2);
        border-radius: 10px;
        padding: 1rem 1.15rem;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }
      /* Alturas fixas compactas — o Chart.js preenche o canvas via
         flex:1 + min-height no .cc-canvas. */
      .chart-card.chart-main { min-height: 180px; }
      .sub-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.85rem;
      }
      .chart-card.chart-dist,
      .chart-card.chart-dow { min-height: 140px; }
      /* Override do gy-table em .chart-table vive no styles.scss global
         (component styles com ::ng-deep nao estavam vencendo a
         especificidade do gy-table base). */

      @media (max-width: 720px) {
        .sub-row { grid-template-columns: 1fr; }
      }

      .cc-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.6rem;
        flex-wrap: wrap;
        gap: 0.5rem;
      }
      .cc-title {
        display: inline-flex;
        align-items: center;
        gap: 0.45rem;
        font-weight: 700;
        font-size: 0.9rem;
      }
      .cc-title .cc-ico {
        width: 24px;
        height: 24px;
        border-radius: 5px;
        background: var(--gy-surface);
        color: var(--gy-green-dark);
        display: grid;
        place-items: center;
        font-size: 0.8rem;
        box-shadow: 0 1px 2px rgba(16, 24, 40, 0.05);
      }
      /* Override dark-mode de .cc-ico vive em styles.scss global. */
      .cc-meta {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
      }
      .cc-sub {
        font-family: 'JetBrains Mono', 'Nunito Sans', monospace;
        font-size: 0.72rem;
        color: var(--gy-text-soft);
      }

      /* PNG buttons */
      .cc-png {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        background: var(--gy-surface);
        border: 1px solid var(--gy-border);
        border-radius: 6px;
        padding: 0.3rem 0.55rem;
        font: inherit;
        font-weight: 700;
        font-size: 0.72rem;
        color: var(--gy-text-soft);
        cursor: pointer;
        transition: background 140ms, border-color 140ms, color 140ms;
      }
      .cc-png:hover {
        background: var(--gy-green-50);
        border-color: var(--gy-green);
        color: var(--gy-green-dark);
      }
      :root[data-theme='dark'] .cc-png:hover { color: var(--gy-green); }
      .cc-png i { font-size: 0.78rem; }

      /* Botão icon-only com tooltip CSS nos sub-charts */
      .cc-icn {
        position: relative;
        width: 28px;
        height: 28px;
        display: grid;
        place-items: center;
        background: var(--gy-surface);
        border: 1px solid var(--gy-border);
        border-radius: 6px;
        color: var(--gy-text-soft);
        cursor: pointer;
        transition: background 140ms, border-color 140ms, color 140ms;
      }
      .cc-icn:hover {
        background: var(--gy-green-50);
        border-color: var(--gy-green);
        color: var(--gy-green-dark);
      }
      :root[data-theme='dark'] .cc-icn:hover { color: var(--gy-green); }
      .cc-icn i { font-size: 0.8rem; }
      .cc-icn::after {
        content: attr(data-tooltip);
        position: absolute;
        bottom: calc(100% + 8px);
        left: 50%;
        transform: translateX(-50%) translateY(4px);
        background: var(--gy-text);
        color: var(--gy-surface);
        font-family: 'Nunito Sans', sans-serif;
        font-size: 0.68rem;
        font-weight: 600;
        padding: 0.28rem 0.5rem;
        border-radius: 5px;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: opacity 140ms, transform 140ms;
        z-index: 10;
      }
      .cc-icn::before {
        content: '';
        position: absolute;
        bottom: calc(100% + 3px);
        left: 50%;
        transform: translateX(-50%) translateY(4px);
        width: 0;
        height: 0;
        border-left: 4px solid transparent;
        border-right: 4px solid transparent;
        border-top: 4px solid var(--gy-text);
        opacity: 0;
        pointer-events: none;
        transition: opacity 140ms, transform 140ms;
        z-index: 10;
      }
      .cc-icn:hover::after,
      .cc-icn:focus::after,
      .cc-icn:hover::before,
      .cc-icn:focus::before {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }

      .cc-canvas {
        flex: 1;
        position: relative;
        min-height: 130px;
      }
      .cc-canvas-sm { min-height: 85px; }
      :host ::ng-deep .cc-canvas > p-chart,
      :host ::ng-deep .cc-canvas > p-chart > div {
        display: block;
        height: 100%;
        width: 100%;
      }
      :host ::ng-deep .cc-canvas canvas {
        width: 100% !important;
        height: 100% !important;
      }
      :host ::ng-deep .chart-skel {
        position: absolute;
        inset: 0;
        border-radius: 8px;
      }

      /* Table styles */
      .right { text-align: right; }
      .num { font-variant-numeric: tabular-nums; font-weight: 600; }
      .mono { font-family: 'JetBrains Mono', 'Nunito Sans', monospace; }
      :host ::ng-deep .ml-auto { margin-left: auto; display: block; }

      .dow-chip {
        display: inline-block;
        font-size: 0.7rem;
        font-weight: 700;
        padding: 0.1rem 0.5rem;
        border-radius: 999px;
        background: var(--gy-surface-2);
        color: var(--gy-text-soft);
        letter-spacing: 0.03em;
        text-transform: uppercase;
      }
      .dow-chip.weekend {
        background: var(--gy-yellow-50);
        color: #92400e;
      }
      :root[data-theme='dark'] .dow-chip {
        background: var(--gy-bg);
      }
      :root[data-theme='dark'] .dow-chip.weekend {
        background: var(--gy-yellow-50);
        color: var(--gy-yellow);
      }
    `,
  ],
})
export class ResultsPanelComponent implements OnInit, OnDestroy {
  readonly store = inject(MetricsStore);
  readonly i18n = inject(I18nService);
  readonly theme = inject(ThemeService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly chartExport = inject(ChartExportService);

  readonly skeletonRows = Array.from({ length: 6 });
  readonly viewMode = signal<ViewMode>('table');
  private pageStart = signal(0);

  /**
   * O ChartExportService so' pode anunciar "tem charts disponiveis"
   * quando TRES condicoes sao verdade simultaneas: view=chart, sem
   * loading, com dados. Reage a mudanca de qualquer uma via effect.
   */
  private readonly exportAvailable = computed(
    () =>
      this.viewMode() === 'chart' &&
      !this.store.loading() &&
      this.store.data().length > 0,
  );

  constructor() {
    // allowSignalWrites: o register/unregister do service escreve no
    // signal hasCharts. Sem essa flag, Angular 17 lança RuntimeError e
    // deixa o componente num estado parcialmente renderizado (acabou
    // cortando rows da tabela em testes).
    effect(
      () => {
        if (this.exportAvailable()) {
          this.chartExport.register(() => this.exportAll());
        } else {
          this.chartExport.unregister();
        }
      },
      { allowSignalWrites: true },
    );
  }

  ngOnInit(): void {
    /* registro efetivo via effect */
  }
  ngOnDestroy(): void {
    this.chartExport.unregister();
  }

  readonly pointsCount = computed(() => this.store.data().length);
  readonly hasData = computed(() => this.store.data().length > 0);
  readonly pointsLabel = computed(() => {
    const n = this.pointsCount();
    const key = n === 1 ? 'results.header.points.one' : 'results.header.points';
    return this.i18n.t(key, { count: n });
  });

  readonly headerInfo = computed(() =>
    this.i18n.t('results.header.info', {
      id: this.store.metricId() ?? '',
      start: formatDate(this.store.dateInitial()),
      end: formatDate(this.store.finalDate()),
      gran: this.granularityLabel(),
    }),
  );

  readonly showInitial = computed(
    () => !this.store.searched() && !this.store.loading(),
  );
  readonly showEmpty = computed(
    () =>
      this.store.searched() &&
      !this.store.loading() &&
      this.store.data().length === 0,
  );

  /**
   * Coluna "Dia da semana" so faz sentido quando a consulta em tela foi
   * por granularidade = DAY. Pra MONTH/YEAR, o backend devolve a data
   * inicial do bucket (01/mm/yyyy ou 01/01/yyyy) — o dia-da-semana
   * dessa data especifica seria ruido. Usa `lastQuery.granularity`
   * (nao `store.granularity()`) pra refletir o dado que ESTA em tela,
   * nao o form (que pode ter sido alterado sem nova consulta).
   */
  readonly showWeekdayColumn = computed(
    () => this.store.lastQuery()?.granularity === 'DAY',
  );

  /**
   * Rows da tabela pre-computadas com dow + isWeekend pra o template
   * nao recalcular a cada render. E' uma leve duplicacao do array do
   * store, mas evita logica no HTML.
   */
  readonly tableRows = computed<TableRow[]>(() => {
    const rows = this.store.data();
    if (rows.length === 0) return [];
    return rows.map((r) => {
      const dowIdx = isoToDow(r.date);
      return {
        date: r.date,
        dow: this.i18n.t(DOW_KEYS[dowIdx]),
        isWeekend: dowIdx === 0 || dowIdx === 6,
        value: r.value,
      };
    });
  });

  readonly tableFrom = computed(() =>
    this.tableRows().length === 0 ? 0 : this.pageStart() + 1,
  );
  readonly tableTo = computed(() =>
    Math.min(this.pageStart() + 12, this.tableRows().length),
  );

  onPage(event: { first: number; rows: number }): void {
    this.pageStart.set(event.first);
  }

  readonly mainChartData = computed<ChartConfiguration<'line'>['data']>(() => {
    const rows = this.store.data();
    const gran = this.store.granularity();
    const bcp47 = this.i18n.bcp47();
    const dark = this.theme.theme() === 'dark';
    const lineColor = dark ? '#A4D330' : '#266400';
    const fillTop = dark ? 'rgba(164, 211, 48, 0.30)' : 'rgba(135, 188, 37, 0.35)';
    const fillBottom = dark ? 'rgba(164, 211, 48, 0)' : 'rgba(135, 188, 37, 0)';
    const peakIdx = this.findPeakIndex(rows);

    return {
      labels: rows.map((r) => formatAxisLabel(r.date, gran, bcp47)),
      datasets: [
        {
          data: rows.map((r) => r.value),
          borderColor: lineColor,
          borderWidth: 2,
          tension: 0.32,
          pointRadius: (ctx) => (ctx.dataIndex === peakIdx ? 5 : 0),
          pointBackgroundColor: '#FCCC1D',
          pointBorderColor: lineColor,
          pointBorderWidth: 2,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: lineColor,
          pointHoverBorderColor: dark ? '#0F1419' : '#ffffff',
          pointHoverBorderWidth: 2,
          fill: true,
          backgroundColor: (ctx: ScriptableContext<'line'>) => {
            const chart = ctx.chart;
            const area = chart.chartArea;
            if (!area) return fillTop;
            const g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
            g.addColorStop(0, fillTop);
            g.addColorStop(1, fillBottom);
            return g;
          },
        },
      ],
    };
  });

  readonly mainChartOptions = computed<ChartConfiguration<'line'>['options']>(
    () => this.commonOptions(),
  );

  distData(h: {
    labels: string[];
    counts: number[];
  }): ChartConfiguration<'bar'>['data'] {
    const maxCount = Math.max(...h.counts);
    return {
      labels: h.labels,
      datasets: [
        {
          data: h.counts,
          backgroundColor: (ctx) => {
            const v = ctx.raw as number;
            const pct = v / maxCount;
            if (pct > 0.7) return '#266400';
            if (pct > 0.4) return '#87BC25';
            return '#C8DE8F';
          },
          borderRadius: 6,
        },
      ],
    };
  }

  dowData(means: number[]): ChartConfiguration<'bar'>['data'] {
    const max = Math.max(...means);
    return {
      labels: DOW_KEYS.map((k) => this.i18n.t(k)),
      datasets: [
        {
          data: means,
          backgroundColor: (ctx) => {
            const v = ctx.raw as number;
            if (v === max) return '#266400';
            if (v < max * 0.85) return '#FCCC1D';
            return '#87BC25';
          },
          borderRadius: 6,
        },
      ],
    };
  }

  readonly subOptions = computed<ChartConfiguration<'bar'>['options']>(() => {
    const dark = this.theme.theme() === 'dark';
    const bcp47 = this.i18n.bcp47();
    const tickColor = dark ? '#94A3B8' : '#9CA3AF';
    const gridColor = dark ? 'rgba(45, 52, 66, .7)' : '#EFEEEB';
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          callbacks: {
            label: (c) =>
              typeof c.parsed.y === 'number'
                ? c.parsed.y.toLocaleString(bcp47)
                : '',
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: tickColor, font: { size: 10 } },
        },
        y: {
          grid: { color: gridColor },
          ticks: { color: tickColor, font: { size: 10 } },
        },
      },
    };
  });

  setView(mode: ViewMode): void {
    this.viewMode.set(mode);
  }

  /**
   * Export PNG de um canvas especifico. O seletor `.chart-<id> canvas`
   * funciona porque cada chart-card carrega a classe correspondente.
   */
  exportOne(id: 'main' | 'dist' | 'dow'): void {
    const el = this.host.nativeElement.querySelector<HTMLCanvasElement>(
      `.chart-${id} canvas`,
    );
    if (!el) return;
    this.downloadCanvas(el, `metric-${this.store.metricId() ?? 'x'}-${id}`);
  }

  /**
   * Baixa os 3 charts visiveis em sequencia. Ordem fixa (main, dist, dow)
   * pra dar nome previsivel no arquivo.
   */
  exportAll(): void {
    (['main', 'dist', 'dow'] as const).forEach((id) => this.exportOne(id));
  }

  private downloadCanvas(canvas: HTMLCanvasElement, name: string): void {
    const bg = this.theme.theme() === 'dark' ? '#1A1F2A' : '#ffffff';
    const temp = document.createElement('canvas');
    temp.width = canvas.width;
    temp.height = canvas.height;
    const ctx = temp.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, temp.width, temp.height);
    ctx.drawImage(canvas, 0, 0);
    const stamp = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = temp.toDataURL('image/png');
    a.download = `${name}-${stamp}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  private findPeakIndex(
    rows: ReadonlyArray<{ value: number }>,
  ): number {
    if (rows.length === 0) return -1;
    let max = rows[0].value;
    let idx = 0;
    for (let i = 1; i < rows.length; i += 1) {
      if (rows[i].value > max) {
        max = rows[i].value;
        idx = i;
      }
    }
    return idx;
  }

  private commonOptions(): ChartConfiguration<'line'>['options'] {
    const dark = this.theme.theme() === 'dark';
    const bcp47 = this.i18n.bcp47();
    const tickColor = dark ? '#94A3B8' : '#6b7280';
    const gridColor = dark ? 'rgba(45, 52, 66, .8)' : 'rgba(229, 231, 235, .7)';
    const tooltipBg = dark ? '#1A1F2A' : '#ffffff';
    const tooltipBorder = dark ? '#2D3442' : '#e5e7eb';
    const tooltipText = dark ? '#E5E7EB' : '#414856';

    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          backgroundColor: tooltipBg,
          borderColor: tooltipBorder,
          borderWidth: 1,
          titleColor: tooltipText,
          bodyColor: tooltipText,
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: (c) =>
              typeof c.parsed.y === 'number'
                ? c.parsed.y.toLocaleString(bcp47)
                : '',
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            autoSkip: true,
            maxTicksLimit: 10,
            color: tickColor,
            font: { size: 11 },
          },
        },
        y: {
          grid: { color: gridColor },
          ticks: {
            color: tickColor,
            font: { size: 11 },
            callback: (v) =>
              typeof v === 'number' ? v.toLocaleString(bcp47) : `${v}`,
          },
          beginAtZero: false,
        },
      },
    };
  }

  granularityLabel(): string {
    switch (this.store.granularity()) {
      case 'DAY':   return this.i18n.t('results.gran.day');
      case 'MONTH': return this.i18n.t('results.gran.month');
      case 'YEAR':  return this.i18n.t('results.gran.year');
    }
  }

  readonly formatDate = formatDate;
}
