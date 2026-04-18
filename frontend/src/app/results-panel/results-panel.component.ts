import { CommonModule } from '@angular/common';
import { Component, ElementRef, computed, inject, signal } from '@angular/core';
import { ChartModule } from 'primeng/chart';
import { TableModule } from 'primeng/table';
import { SkeletonModule } from 'primeng/skeleton';
import type { ChartConfiguration, ScriptableContext } from 'chart.js';
import { MetricsStore } from '../metrics.store';
import { ThemeService } from '../theme.service';
import { I18nService } from '../i18n/i18n.service';
import { formatDate } from '../format.util';

type ViewMode = 'chart' | 'table';

/**
 * Formata um `YYYY-MM-DD` (como devolvido pelo /aggregate) pra label de eixo
 * conforme a granularidade e o idioma. Parse manual evita o off-by-one que o
 * `new Date('YYYY-MM-DD')` causa em timezones negativos. Abreviacoes de mes
 * vem do Intl.DateTimeFormat no BCP47 do idioma escolhido.
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

@Component({
  selector: 'app-results-panel',
  standalone: true,
  imports: [CommonModule, ChartModule, TableModule, SkeletonModule],
  template: `
    <section class="panel" aria-labelledby="results-title">
      <header class="panel-head">
        <div class="head-left">
          <h2 id="results-title">{{ i18n.t('results.title') }}</h2>
          <p>
            @if (store.searched() && store.isFormValid()) {
              {{ headerInfo() }}
            } @else {
              {{ i18n.t('results.header.prompt') }}
            }
          </p>
        </div>

        <div class="head-right">
          @if (canExport()) {
            <button
              type="button"
              class="export-btn"
              (click)="exportPng()"
              [attr.aria-label]="i18n.t('results.exportPng.aria')"
              [attr.title]="i18n.t('results.exportPng.title')"
            >
              <i class="pi pi-download" aria-hidden="true"></i>
              <span>PNG</span>
            </button>
          }
          <div
            class="view-toggle"
            role="tablist"
            [attr.aria-label]="i18n.t('results.view.aria')"
          >
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="viewMode() === 'chart'"
              [class.on]="viewMode() === 'chart'"
              (click)="setView('chart')"
              [attr.title]="i18n.t('results.view.chart')"
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
              [attr.title]="i18n.t('results.view.table')"
            >
              <i class="pi pi-table" aria-hidden="true"></i>
              <span>{{ i18n.t('results.view.table') }}</span>
            </button>
          </div>
        </div>
      </header>

      <div class="kpis" aria-live="polite">
        <div class="kpi">
          <span class="kpi-label">{{ i18n.t('results.kpi.total') }}</span>
          @if (store.loading()) {
            <p-skeleton width="5rem" height="1.3rem" />
          } @else {
            <span class="kpi-value">{{ store.total() | number }}</span>
          }
        </div>
        <div class="kpi">
          <span class="kpi-label">{{ i18n.t('results.kpi.avg') }}</span>
          @if (store.loading()) {
            <p-skeleton width="4rem" height="1.3rem" />
          } @else {
            <span class="kpi-value">{{ store.kpis().avg | number }}</span>
          }
        </div>
        <div class="kpi">
          <span class="kpi-label">{{ i18n.t('results.kpi.max') }}</span>
          @if (store.loading()) {
            <p-skeleton width="4rem" height="1.3rem" />
          } @else {
            <span class="kpi-value">{{ store.kpis().max | number }}</span>
            @if (store.kpis().maxDate) {
              <span class="kpi-sub">{{ store.kpis().maxDate }}</span>
            }
          }
        </div>
        <div class="kpi">
          <span class="kpi-label">{{ i18n.t('results.kpi.min') }}</span>
          @if (store.loading()) {
            <p-skeleton width="4rem" height="1.3rem" />
          } @else {
            <span class="kpi-value">{{ store.kpis().min | number }}</span>
            @if (store.kpis().minDate) {
              <span class="kpi-sub">{{ store.kpis().minDate }}</span>
            }
          }
        </div>
      </div>

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
          <div class="chart-box" [class.is-loading]="store.loading()">
            @if (store.loading()) {
              <p-skeleton width="100%" height="100%" styleClass="chart-skel" />
            } @else {
              <p-chart
                type="line"
                [data]="chartData()"
                [options]="chartOptions()"
              />
            }
          </div>
        } @else {
          <p-table
            [value]="store.loading() ? skeletonRows : store.data()"
            [styleClass]="'gy-table' + (store.loading() ? ' is-loading' : '')"
            [paginator]="!store.loading() && store.data().length > 12"
            [rows]="12"
            [tableStyle]="{ 'min-width': '320px' }"
          >
            <ng-template pTemplate="header">
              <tr>
                <th scope="col">{{ i18n.t('results.table.date') }}</th>
                <th scope="col" class="right">{{ i18n.t('results.table.value') }}</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-row>
              @if (store.loading()) {
                <tr aria-hidden="true">
                  <td><p-skeleton width="7rem" height="0.95rem" /></td>
                  <td class="right">
                    <p-skeleton width="4rem" height="0.95rem" styleClass="ml-auto" />
                  </td>
                </tr>
              } @else {
                <tr>
                  <td>{{ row.date }}</td>
                  <td class="right num">{{ row.value | number }}</td>
                </tr>
              }
            </ng-template>
          </p-table>
        }
      </div>
    </section>
  `,
  styles: [
    `
      :host { display: block; width: 100%; }
      .panel {
        background: var(--gy-surface);
        border: 1px solid var(--gy-border);
        border-radius: 14px;
        padding: 1.5rem;
        box-shadow: var(--gy-shadow);
        height: 100%;
        display: flex;
        flex-direction: column;
      }
      .panel-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 1rem;
        margin-bottom: 1.25rem;
        flex-wrap: wrap;
      }
      .head-left h2 {
        font-family: 'Nunito', sans-serif;
        font-size: 1.05rem;
        font-weight: 800;
        margin: 0 0 0.2rem;
      }
      .head-left p {
        margin: 0;
        font-size: 0.85rem;
        color: var(--gy-text-soft);
      }

      .head-right {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .export-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        background: var(--gy-surface-2);
        border: 1px solid var(--gy-border);
        border-radius: 8px;
        padding: 0.4rem 0.7rem;
        font: inherit;
        font-size: 0.78rem;
        font-weight: 700;
        color: var(--gy-text-soft);
        cursor: pointer;
        transition: background 140ms, border-color 140ms, color 140ms;
      }
      .export-btn:hover {
        background: var(--gy-green-50);
        border-color: var(--gy-green);
        color: var(--gy-green-dark);
      }
      :root[data-theme='dark'] .export-btn:hover { color: var(--gy-green); }
      .export-btn i { font-size: 0.8rem; }

      /* View toggle (chart/tabela) */
      .view-toggle {
        display: inline-flex;
        gap: 0.25rem;
        background: var(--gy-surface-2);
        border: 1px solid var(--gy-border);
        border-radius: 10px;
        padding: 0.25rem;
      }
      .view-toggle button {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        border: 0;
        background: transparent;
        padding: 0.4rem 0.75rem;
        border-radius: 7px;
        font: inherit;
        font-weight: 700;
        font-size: 0.78rem;
        color: var(--gy-text-soft);
        cursor: pointer;
        transition: background 140ms ease, color 140ms ease;
      }
      .view-toggle button:hover:not(.on) {
        background: var(--gy-green-50);
        color: var(--gy-green-dark);
      }
      :root[data-theme='dark'] .view-toggle button:hover:not(.on) {
        color: var(--gy-green);
      }
      .view-toggle button.on {
        background: var(--gy-green-dark);
        color: #fff;
      }
      :root[data-theme='dark'] .view-toggle button.on {
        background: var(--gy-green);
        color: var(--gy-bg);
      }
      .view-toggle i { font-size: 0.85rem; }

      /* KPIs */
      .kpis {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 0.6rem;
        margin-bottom: 1.1rem;
      }
      .kpi {
        background: var(--gy-surface-2);
        border: 1px solid var(--gy-border-soft);
        border-radius: 10px;
        padding: 0.65rem 0.8rem;
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        position: relative;
        overflow: hidden;
      }
      .kpi::before {
        content: '';
        position: absolute;
        left: 0; top: 0; bottom: 0;
        width: 3px;
        background: var(--gy-green);
      }
      .kpi:nth-child(2)::before { background: var(--gy-yellow); }
      .kpi:nth-child(3)::before { background: var(--gy-green-dark); }
      :root[data-theme='dark'] .kpi:nth-child(3)::before {
        background: var(--gy-green);
      }
      .kpi:nth-child(4)::before { background: var(--gy-text-soft); }
      .kpi-label {
        font-size: 0.68rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--gy-text-soft);
      }
      .kpi-value {
        font-family: 'Nunito', sans-serif;
        font-weight: 800;
        font-size: 1.1rem;
        font-variant-numeric: tabular-nums;
        color: var(--gy-text);
      }
      .kpi-sub {
        font-size: 0.7rem;
        color: var(--gy-text-soft);
        font-variant-numeric: tabular-nums;
      }

      @media (max-width: 640px) {
        .kpis { grid-template-columns: repeat(2, 1fr); }
      }

      /* Body */
      .body {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
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
        border-radius: 12px;
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

      /* Chart */
      .chart-box {
        flex: 1;
        min-height: 260px;
        position: relative;
        /* Respiro entre os KPIs e o gráfico — sem isso encosta demais */
        margin-top: 1rem;
      }
      /* Cadeia de height:100% pra o canvas do Chart.js herdar o flex:1
         do .chart-box. p-chart renderiza <p-chart> > <div> > <canvas>;
         a <div> interna nao tem classe nem altura propria, entao força
         aqui com ::ng-deep pra nao quebrar o responsive do Chart.js. */
      :host ::ng-deep .chart-box > p-chart,
      :host ::ng-deep .chart-box > p-chart > div {
        display: block;
        height: 100%;
        width: 100%;
      }
      :host ::ng-deep .chart-box canvas {
        width: 100% !important;
        height: 100% !important;
      }
      :host ::ng-deep .chart-skel {
        position: absolute; inset: 0; border-radius: 10px;
      }

      .right { text-align: right; }
      .num { font-variant-numeric: tabular-nums; font-weight: 600; }
      :host ::ng-deep .ml-auto { margin-left: auto; display: block; }
    `,
  ],
})
export class ResultsPanelComponent {
  readonly store = inject(MetricsStore);
  readonly i18n = inject(I18nService);
  private readonly theme = inject(ThemeService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly skeletonRows = Array.from({ length: 6 });
  readonly viewMode = signal<ViewMode>('chart');

  readonly canExport = computed(
    () =>
      this.viewMode() === 'chart' &&
      !this.store.loading() &&
      this.store.data().length > 0,
  );

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

  readonly chartData = computed<ChartConfiguration<'line'>['data']>(() => {
    const rows = this.store.data();
    const gran = this.store.granularity();
    const bcp47 = this.i18n.bcp47();
    // Dark mode leitura no theme signal: recomputa `chartData` quando troca o
    // tema pra atualizar a cor da linha/area sem precisar recriar o canvas.
    const dark = this.theme.theme() === 'dark';
    const lineColor = dark ? '#A4D330' /* --gy-green */ : '#266400' /* --gy-green-dark */;
    const fillTop = dark ? 'rgba(164, 211, 48, 0.30)' : 'rgba(135, 188, 37, 0.35)';
    const fillBottom = dark ? 'rgba(164, 211, 48, 0)' : 'rgba(135, 188, 37, 0)';

    return {
      labels: rows.map((r) => formatAxisLabel(r.date, gran, bcp47)),
      datasets: [
        {
          data: rows.map((r) => r.value),
          borderColor: lineColor,
          borderWidth: 2,
          tension: 0.32,
          pointRadius: 0,
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

  readonly chartOptions = computed<ChartConfiguration<'line'>['options']>(() => {
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
  });

  setView(mode: ViewMode): void {
    this.viewMode.set(mode);
  }

  /**
   * Exporta o canvas atual do Chart.js como PNG. Nao usamos
   * `Chart.toBase64Image()` direto pra nao precisar guardar referencia
   * da instancia — o canvas do p-chart esta dentro do template, entao
   * pegamos via querySelector no proprio host do componente.
   *
   * Fundo transparente no light mode fica feio em ferramentas que abrem
   * o PNG em fundo branco? nao — o fundo ja e' efetivamente branco.
   * No dark mode o canvas e' transparente tambem, entao a area do grid
   * fica escura quando colado num editor claro. Solucao: pintamos um
   * fundo no canvas antes do toDataURL.
   */
  exportPng(): void {
    const canvas = this.host.nativeElement.querySelector<HTMLCanvasElement>(
      '.chart-box canvas',
    );
    if (!canvas) return;
    const bg = this.theme.theme() === 'dark' ? '#1A1F2A' : '#ffffff';

    // Desenha sobre um canvas temporario com fundo solido pra evitar
    // transparencia no PNG final.
    const temp = document.createElement('canvas');
    temp.width = canvas.width;
    temp.height = canvas.height;
    const ctx = temp.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, temp.width, temp.height);
    ctx.drawImage(canvas, 0, 0);

    const metricId = this.store.metricId() ?? 'metric';
    const stamp = new Date().toISOString().slice(0, 10);
    const dataUrl = temp.toDataURL('image/png');

    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `metric-${metricId}-${stamp}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
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
