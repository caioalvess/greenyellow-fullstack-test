import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { CalendarModule } from 'primeng/calendar';
import { SelectButtonModule } from 'primeng/selectbutton';
import { MetricsStore } from '../metrics.store';
import { Granularity } from '../models';
import { DateMaskDirective } from '../date-mask.directive';
import { formatBytes, formatDate, formatNumber } from '../format.util';
import { I18nService } from '../i18n/i18n.service';
import { ChartExportService } from '../chart-export.service';

type PresetId = 'last7' | 'last30' | 'thisMonth' | 'thisYear';
interface Preset {
  id: PresetId;
  key: string;
}
const PRESETS: Preset[] = [
  { id: 'last7',     key: 'filters.presets.last7' },
  { id: 'last30',    key: 'filters.presets.last30' },
  { id: 'thisMonth', key: 'filters.presets.thisMonth' },
  { id: 'thisYear',  key: 'filters.presets.thisYear' },
];

@Component({
  selector: 'app-filters-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    InputNumberModule,
    CalendarModule,
    SelectButtonModule,
    DateMaskDirective,
  ],
  template: `
    <section class="filters" aria-labelledby="filters-title">
      <h2 id="filters-title" class="sr-only">{{ i18n.t('filters.title') }}</h2>

      <!-- Arquivo -->
      <div class="sec-title">{{ i18n.t('filters.sections.file') }}</div>
      <div
        class="dropzone"
        [class.is-dragging]="isDragging()"
        [class.is-uploading]="store.uploading()"
        [class.is-processing]="isProcessing()"
        [class.is-failed]="isFailed()"
        [class.is-completed]="isCompleted()"
        [class.is-pending]="!!store.pendingCsv()"
        [class.is-idle]="isIdle()"
        (dragover)="onDragOver($event)"
        (dragleave)="onDragLeave($event)"
        (drop)="onDrop($event)"
        [attr.role]="store.pendingCsv() ? null : 'button'"
        [attr.tabindex]="store.pendingCsv() ? null : 0"
        [attr.aria-label]="store.pendingCsv() ? null : i18n.t('filters.drop.aria')"
        (click)="onDropZoneClick($event, fileInput)"
        (keydown.enter)="onDropZoneKey($event, fileInput)"
        (keydown.space)="onDropZoneKey($event, fileInput)"
      >
        <input
          #fileInput
          type="file"
          accept=".csv"
          hidden
          (change)="onFileSelected($event)"
        />

        @if (store.pendingCsv(); as pending) {
          <div class="dz-body dz-preview" role="group" [attr.aria-label]="i18n.t('filters.preview.title')">
            <div class="dz-head">
              <div class="dz-ico ico-info"><i class="pi pi-file" aria-hidden="true"></i></div>
              <strong>{{ i18n.t('filters.preview.title') }}</strong>
            </div>
            <dl class="dz-grid">
              <dt>{{ i18n.t('filters.preview.file') }}</dt>
              <dd class="truncate">
                {{ pending.file.name }}
                <span class="muted">· {{ formatBytes(pending.file.size) }}</span>
              </dd>
              <dt>{{ i18n.t('filters.preview.rows') }}</dt>
              <dd>
                @if (pending.meta.rowCount !== null) {
                  <span class="pill">{{ formatNumber(pending.meta.rowCount) }}</span>
                } @else {
                  <em class="muted">{{ i18n.t('filters.preview.unknown') }}</em>
                }
              </dd>
              <dt>{{ i18n.t('filters.preview.range') }}</dt>
              <dd>
                @if (pending.meta.firstDate && pending.meta.lastDate) {
                  {{ formatDate(pending.meta.firstDate) }} → {{ formatDate(pending.meta.lastDate) }}
                } @else {
                  <em class="muted">{{ i18n.t('filters.preview.unknown') }}</em>
                }
              </dd>
            </dl>
            <div class="dz-actions">
              <button type="button" class="dz-btn ghost" (click)="onCancelPending($event)">
                {{ i18n.t('filters.preview.cancel') }}
              </button>
              <button type="button" class="dz-btn primary" (click)="onConfirmPending($event)">
                <i class="pi pi-send" aria-hidden="true"></i>
                {{ i18n.t('filters.preview.confirm') }}
              </button>
            </div>
          </div>
        } @else if (store.uploading()) {
          <div class="dz-body dz-center">
            <i class="pi pi-spin pi-spinner dz-ico-plain" aria-hidden="true"></i>
            <strong>{{ i18n.t('filters.drop.uploading') }}</strong>
          </div>
        } @else if (isProcessing()) {
          <div class="dz-body">
            <div class="dz-head">
              <div class="dz-ico ico-processing"><i class="pi pi-spin pi-cog" aria-hidden="true"></i></div>
              <strong>{{ i18n.t('filters.drop.processing') }}</strong>
            </div>
            <div class="dz-fname truncate">{{ store.lastUpload()?.originalName }}</div>
            <div class="dz-meta">
              <span><b>{{ formatNumber(store.uploadStatus()?.rowsProcessed ?? 0) }}</b> linhas</span>
            </div>
            <div class="dz-bar"><span class="dz-bar-indeterminate"></span></div>
          </div>
        } @else if (isFailed()) {
          <div class="dz-body">
            <div class="dz-head">
              <div class="dz-ico ico-failed"><i class="pi pi-exclamation-triangle" aria-hidden="true"></i></div>
              <strong>{{ i18n.t('filters.drop.failed') }}</strong>
            </div>
            <div class="dz-err truncate">
              {{ store.uploadStatus()?.error || i18n.t('filters.drop.unknownError') }}
            </div>
            <button
              type="button"
              class="dz-x"
              (click)="onClear($event)"
              (keydown.enter)="$event.stopPropagation()"
              (keydown.space)="$event.stopPropagation()"
              [attr.aria-label]="i18n.t('filters.drop.removeFailedAria')"
              [attr.title]="i18n.t('filters.drop.removeTitleShort')"
            >
              <i class="pi pi-times" aria-hidden="true"></i>
            </button>
          </div>
        } @else if (isCompleted()) {
          <div class="dz-body">
            <div class="dz-head">
              <div class="dz-ico ico-ok"><i class="pi pi-check" aria-hidden="true"></i></div>
              <strong>{{ i18n.t('filters.drop.completed') }}</strong>
            </div>
            <div class="dz-fname truncate">{{ store.lastUpload()?.originalName }}</div>
            <div class="dz-meta">
              <span>
                <b>{{ formatNumber(store.uploadStatus()?.rowsProcessed ?? 0) }}</b> linhas
              </span>
              <span class="muted">· {{ formatBytes(store.lastUpload()?.size ?? 0) }}</span>
            </div>
            <button
              type="button"
              class="dz-x"
              (click)="onClear($event)"
              (keydown.enter)="$event.stopPropagation()"
              (keydown.space)="$event.stopPropagation()"
              [attr.aria-label]="i18n.t('filters.drop.removeAria')"
              [attr.title]="i18n.t('filters.drop.removeTitle')"
            >
              <i class="pi pi-times" aria-hidden="true"></i>
            </button>
          </div>
        } @else {
          <div class="dz-body dz-center">
            <i class="pi pi-cloud-upload dz-ico-plain" aria-hidden="true"></i>
            <strong>{{ i18n.t('filters.drop.default') }}</strong>
            <small>{{ i18n.t('filters.drop.defaultHint') }}</small>
          </div>
        }
      </div>

      <!-- Consulta -->
      <div class="sec-title">{{ i18n.t('filters.sections.query') }}</div>

      <div class="field">
        <label for="metricId">MetricId</label>
        <p-inputNumber
          inputId="metricId"
          [ngModel]="store.metricId()"
          (ngModelChange)="store.metricId.set($event)"
          [useGrouping]="false"
          [min]="0"
          [placeholder]="i18n.t('filters.placeholders.metricId')"
          aria-required="true"
        />
      </div>

      <div class="field-row">
        <div class="field">
          <label for="dateInitial">{{ i18n.t('filters.labels.dateFrom') }}</label>
          <p-calendar
            inputId="dateInitial"
            [ngModel]="store.dateInitial()"
            (ngModelChange)="store.dateInitial.set($event)"
            dateFormat="dd-mm-yy"
            [showIcon]="true"
            iconDisplay="input"
            appendTo="body"
            [placeholder]="i18n.t('filters.placeholders.date')"
            aria-required="true"
            appDateMask
          />
        </div>
        <div class="field">
          <label for="finalDate">{{ i18n.t('filters.labels.dateTo') }}</label>
          <p-calendar
            inputId="finalDate"
            [ngModel]="store.finalDate()"
            (ngModelChange)="store.finalDate.set($event)"
            dateFormat="dd-mm-yy"
            [showIcon]="true"
            iconDisplay="input"
            appendTo="body"
            [placeholder]="i18n.t('filters.placeholders.date')"
            aria-required="true"
            appDateMask
          />
        </div>
      </div>

      <div
        class="presets"
        role="group"
        [attr.aria-label]="i18n.t('filters.presets.label')"
      >
        @for (preset of presets; track preset.id) {
          <button
            type="button"
            class="preset-chip"
            (click)="applyPreset(preset.id)"
          >
            {{ i18n.t(preset.key) }}
          </button>
        }
      </div>

      <div class="field">
        <label id="granularity-label">{{ i18n.t('filters.labels.granularity') }}</label>
        <p-selectButton
          [options]="granularityOptions()"
          [ngModel]="store.granularity()"
          (ngModelChange)="store.granularity.set($event)"
          optionLabel="label"
          optionValue="value"
          aria-labelledby="granularity-label"
        />
      </div>

      <div class="actions">
        <p-button
          [label]="i18n.t('filters.actions.consult')"
          icon="pi pi-search"
          (onClick)="store.consultar()"
          [loading]="store.loading()"
          [disabled]="!store.isSubmittable()"
          styleClass="w-full gy-btn-primary"
        />
        <p-button
          [label]="i18n.t('filters.actions.excel')"
          icon="pi pi-file-excel"
          severity="success"
          [outlined]="true"
          (onClick)="store.baixarExcel()"
          [disabled]="!store.isSubmittable()"
          styleClass="w-full gy-btn-out"
        />
        @if (showExportPngs()) {
          <p-button
            [label]="i18n.t('filters.actions.downloadPngs')"
            icon="pi pi-images"
            severity="success"
            [outlined]="true"
            (onClick)="chartExport.exportAll()"
            styleClass="w-full gy-btn-out"
          />
        }
        @if (store.isFormValid() && !store.isSubmittable()) {
          <small class="hint-missing-upload" role="status">
            <i class="pi pi-info-circle" aria-hidden="true"></i>
            {{ i18n.t('filters.hints.needUpload') }}
          </small>
        }
      </div>
    </section>
  `,
  styles: [
    `
      :host { display: block; width: 100%; }
      .filters {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
      }
      .sr-only {
        position: absolute; width: 1px; height: 1px;
        padding: 0; margin: -1px; overflow: hidden;
        clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
      }

      /* Titulos de secao ("Arquivo" / "Consulta"): tipografia com mais
         presenca + divisor inferior sutil pra ancorar visualmente os
         blocos que vem abaixo. */
      .sec-title {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-family: 'Nunito', sans-serif;
        font-size: 0.74rem;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--gy-text);
        margin: 1.4rem 0 0.85rem;
        padding-bottom: 0.4rem;
        border-bottom: 1px solid var(--gy-border-soft);
      }
      .sec-title::before {
        content: '';
        width: 4px;
        height: 14px;
        border-radius: 2px;
        background: linear-gradient(180deg, var(--gy-green), var(--gy-green-dark));
      }
      :root[data-theme='dark'] .sec-title::before {
        background: linear-gradient(180deg, #A4D330, var(--gy-green));
      }
      .sec-title:first-of-type { margin-top: 0.25rem; }

      /* ========== Dropzone ========== */
      /* Estado "idle" (vazio/uploading): dashed light + inviting.
         Demais estados: dark card com brand glow verde/amarelo/vermelho. */
      .dropzone {
        position: relative;
        border-radius: 10px;
        padding: 1.3rem 1.2rem;
        min-height: 160px;
        outline: none;
        cursor: pointer;
        transition: border-color 240ms ease, background-color 240ms ease;
        overflow: hidden;
      }
      .dropzone.is-idle,
      .dropzone.is-uploading {
        border: 2px dashed var(--gy-border);
        background: var(--gy-surface-2);
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
      }
      .dropzone.is-idle:hover,
      .dropzone.is-idle:focus-visible,
      .dropzone.is-idle.is-dragging {
        border-color: var(--gy-green);
        background: var(--gy-green-50);
      }
      .dropzone.is-idle:focus-visible { box-shadow: var(--focus-ring); }

      /* Dark card variant para estados informativos */
      .dropzone.is-pending,
      .dropzone.is-processing,
      .dropzone.is-failed,
      .dropzone.is-completed {
        background: linear-gradient(160deg, #1A1F2A, #0B0F14);
        color: #E5E7EB;
        border: 1px solid #2D3442;
        cursor: default;
      }
      .dropzone.is-pending::before,
      .dropzone.is-processing::before,
      .dropzone.is-failed::before,
      .dropzone.is-completed::before {
        content: '';
        position: absolute;
        top: -40px; right: -40px;
        width: 140px; height: 140px;
        border-radius: 50%;
        pointer-events: none;
      }
      .dropzone.is-pending::before,
      .dropzone.is-completed::before {
        background: radial-gradient(circle, rgba(164, 211, 48, 0.3), transparent 60%);
      }
      .dropzone.is-processing::before {
        background: radial-gradient(circle, rgba(252, 204, 29, 0.3), transparent 60%);
      }
      .dropzone.is-failed::before {
        background: radial-gradient(circle, rgba(239, 68, 68, 0.3), transparent 60%);
      }

      .dz-body { position: relative; }
      .dz-center {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.4rem;
      }
      .dz-center .dz-ico-plain {
        font-size: 2.2rem;
        color: var(--gy-green-dark);
        margin-bottom: 0.5rem;
      }
      :root[data-theme='dark'] .dz-center .dz-ico-plain {
        color: var(--gy-green);
      }
      .dropzone.is-idle strong,
      .dropzone.is-uploading strong {
        font-family: 'Nunito', sans-serif;
        font-size: 0.98rem;
        color: var(--gy-text);
      }
      .dropzone.is-idle small {
        font-size: 0.78rem;
        color: var(--gy-text-soft);
      }

      /* Head row para estados dark */
      .dz-head {
        display: flex;
        align-items: center;
        gap: 0.55rem;
        margin-bottom: 0.5rem;
      }
      .dz-ico {
        width: 28px; height: 28px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        font-size: 0.85rem;
        font-weight: 900;
        flex: 0 0 28px;
      }
      .dz-ico.ico-ok {
        background: linear-gradient(135deg, #A4D330, var(--gy-green));
        color: #0B1F05;
        box-shadow: 0 4px 10px rgba(164, 211, 48, 0.35);
      }
      .dz-ico.ico-processing {
        background: linear-gradient(135deg, #FCCC1D, #E0AB00);
        color: #3F2F00;
      }
      .dz-ico.ico-failed {
        background: #EF4444;
        color: #fff;
      }
      .dz-ico.ico-info {
        background: rgba(255, 255, 255, 0.1);
        color: #E5E7EB;
        border-radius: 6px;
      }
      .dz-head strong {
        font-family: 'Nunito', sans-serif;
        font-weight: 800;
        font-size: 0.88rem;
        color: #fff;
      }

      .dz-fname {
        font-family: 'JetBrains Mono', 'Nunito Sans', monospace;
        font-size: 0.78rem;
        color: #E5E7EB;
        font-weight: 600;
        margin-bottom: 0.25rem;
      }
      .dz-meta {
        font-family: 'JetBrains Mono', 'Nunito Sans', monospace;
        font-size: 0.72rem;
        color: #94A3B8;
        display: flex;
        gap: 0.35rem;
        flex-wrap: wrap;
      }
      .dz-meta b { color: #A4D330; font-weight: 600; }
      .dz-meta .muted { color: #6b7280; }

      .dz-err {
        font-size: 0.76rem;
        color: #FCA5A5;
        margin-top: 0.15rem;
      }

      .dz-bar {
        height: 4px;
        background: rgba(255, 255, 255, 0.08);
        border-radius: 999px;
        margin-top: 0.65rem;
        overflow: hidden;
        position: relative;
      }
      .dz-bar-indeterminate {
        position: absolute;
        top: 0; left: 0;
        height: 100%;
        width: 35%;
        background: linear-gradient(90deg, transparent 0%, #FCCC1D 50%, transparent 100%);
        animation: dz-bar 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
      }
      @keyframes dz-bar {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(380%); }
      }

      .dz-x {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        width: 26px;
        height: 26px;
        border: 0;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.06);
        color: #94A3B8;
        display: grid;
        place-items: center;
        cursor: pointer;
        font-size: 0.78rem;
        transition: background 140ms, color 140ms;
      }
      .dz-x:hover {
        background: rgba(239, 68, 68, 0.2);
        color: #FCA5A5;
      }

      /* Preview grid (file · metricId · range) */
      .dz-grid {
        display: grid;
        grid-template-columns: auto 1fr;
        column-gap: 0.65rem;
        row-gap: 0.35rem;
        margin: 0 0 0.75rem;
        font-size: 0.78rem;
      }
      .dz-grid dt {
        font-size: 0.64rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #94A3B8;
        font-weight: 700;
        padding-top: 0.15rem;
      }
      .dz-grid dd {
        margin: 0;
        color: #E5E7EB;
        display: flex;
        align-items: center;
        gap: 0.4rem;
        flex-wrap: wrap;
        min-width: 0;
      }
      .dz-grid dd .pill {
        display: inline-block;
        padding: 0.1rem 0.5rem;
        border-radius: 999px;
        background: rgba(164, 211, 48, 0.15);
        color: #A4D330;
        font-size: 0.72rem;
        font-weight: 800;
        font-variant-numeric: tabular-nums;
      }
      .dz-grid dd .muted {
        color: #94A3B8;
        font-size: 0.74rem;
      }

      .truncate {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .dz-actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.4rem;
      }
      .dz-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        padding: 0.4rem 0.75rem;
        border-radius: 6px;
        font-weight: 700;
        font-size: 0.78rem;
        cursor: pointer;
        border: 1px solid transparent;
        transition: background 140ms, color 140ms, transform 120ms;
      }
      .dz-btn.ghost {
        background: transparent;
        color: #94A3B8;
        border-color: rgba(255, 255, 255, 0.12);
      }
      .dz-btn.ghost:hover { background: rgba(255, 255, 255, 0.06); color: #fff; }
      .dz-btn.primary {
        background: linear-gradient(135deg, #A4D330, var(--gy-green));
        color: #0B1F05;
      }
      .dz-btn.primary:hover { transform: translateY(-1px); }

      /* ========== Form fields ========== */
      .field {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
        margin-bottom: 0.75rem;
      }
      .field label {
        font-size: 0.68rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--gy-text-soft);
        font-weight: 700;
      }
      .field-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.5rem;
      }

      .presets {
        display: flex;
        flex-wrap: wrap;
        gap: 0.3rem;
        margin: 0 0 0.9rem;
      }
      .preset-chip {
        background: var(--gy-surface-2);
        border: 1px solid var(--gy-border);
        color: var(--gy-text-soft);
        padding: 0.3rem 0.7rem;
        border-radius: 999px;
        font: inherit;
        font-size: 0.73rem;
        font-weight: 700;
        cursor: pointer;
        transition: background 140ms, border-color 140ms, color 140ms;
      }
      .preset-chip:hover {
        background: var(--gy-green-50);
        border-color: var(--gy-green);
        color: var(--gy-green-dark);
      }
      :root[data-theme='dark'] .preset-chip:hover { color: var(--gy-green); }

      .actions {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin-top: 0.85rem;
      }
      .hint-missing-upload {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        margin-top: 0.35rem;
        font-size: 0.78rem;
        color: var(--gy-text-soft);
      }
      .hint-missing-upload i { color: var(--gy-green); }

      :host ::ng-deep .w-full { width: 100%; }
      :host ::ng-deep .w-full .p-button { width: 100%; justify-content: center; }
      :host ::ng-deep .p-inputnumber { width: 100%; }
      :host ::ng-deep .p-inputnumber input { width: 100%; }
      :host ::ng-deep .p-calendar { width: 100%; }
      :host ::ng-deep .p-calendar input { width: 100%; }
      :host ::ng-deep .p-selectbutton { display: flex; }
      :host ::ng-deep .p-selectbutton .p-button { flex: 1; justify-content: center; }

      /* Consultar: lime gradient (primary chamativo da marca) */
      :host ::ng-deep .gy-btn-primary .p-button {
        background: linear-gradient(135deg, #A4D330 0%, var(--gy-green) 55%, var(--gy-green-dark) 100%);
        border-color: var(--gy-green-dark);
        color: #0B1F05;
        font-weight: 800;
        padding: 0.9rem 1.1rem;
      }
      :host ::ng-deep .gy-btn-primary .p-button:hover:not(:disabled) {
        box-shadow: 0 8px 20px rgba(135, 188, 37, 0.28);
      }
      :host ::ng-deep .gy-btn-out .p-button {
        padding: 0.85rem 1.1rem;
        font-weight: 800;
      }
    `,
  ],
})
export class FiltersPanelComponent {
  readonly store = inject(MetricsStore);
  readonly i18n = inject(I18nService);
  readonly chartExport = inject(ChartExportService);
  readonly isDragging = signal(false);
  readonly presets = PRESETS;

  /**
   * Labels da granularidade recomputam quando o idioma muda — ligar em
   * `i18n.locale()` via computed garante que o SelectButton re-renderize
   * sem refletir a UI inteira.
   */
  readonly granularityOptions = computed<
    Array<{ label: string; value: Granularity }>
  >(() => [
    { label: this.i18n.t('filters.granularity.day'),   value: 'DAY' },
    { label: this.i18n.t('filters.granularity.month'), value: 'MONTH' },
    { label: this.i18n.t('filters.granularity.year'),  value: 'YEAR' },
  ]);

  readonly isProcessing = computed(() => {
    const s = this.store.uploadStatus()?.state;
    return s === 'pending' || s === 'processing';
  });
  readonly isFailed = computed(
    () => this.store.uploadStatus()?.state === 'failed',
  );
  readonly isCompleted = computed(() => {
    if (!this.store.lastUpload()) return false;
    if (this.isProcessing()) return false;
    if (this.isFailed()) return false;
    return true;
  });
  /**
   * Estado "idle" do dropzone: sem preview, sem upload em andamento,
   * sem arquivo enviado. UI mostra o visual leve (dashed, inviting).
   */
  readonly isIdle = computed(
    () =>
      !this.store.pendingCsv() &&
      !this.store.uploading() &&
      !this.store.lastUpload(),
  );

  /**
   * "Baixar PNGs" so' faz sentido em view=chart com dado presente.
   * chartExport.hasCharts reflete se o ResultsPanel registrou sua
   * funcao de export (viewMode === 'chart' && data.length > 0).
   */
  readonly showExportPngs = computed(() => this.chartExport.hasCharts());

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(true);
  }
  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
  }
  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) void this.store.acceptCsvFile(file);
  }
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void this.store.acceptCsvFile(file);
    input.value = '';
  }

  onClear(event: MouseEvent): void {
    event.stopPropagation();
    this.store.clearUpload();
  }

  onDropZoneClick(event: MouseEvent, input: HTMLInputElement): void {
    if (this.store.pendingCsv()) return;
    if ((event.target as HTMLElement).closest('.dz-x, .dz-btn')) return;
    if (!this.isIdle() && !this.isFailed()) return;
    input.click();
  }
  onDropZoneKey(event: Event, input: HTMLInputElement): void {
    if (this.store.pendingCsv()) return;
    event.preventDefault();
    input.click();
  }

  onConfirmPending(event: MouseEvent): void {
    event.stopPropagation();
    this.store.confirmPendingUpload();
  }
  onCancelPending(event: MouseEvent): void {
    event.stopPropagation();
    this.store.cancelPendingUpload();
  }

  applyPreset(id: PresetId): void {
    const today = startOfDay(new Date());
    let start: Date;
    let end: Date;
    switch (id) {
      case 'last7': {
        end = today;
        start = new Date(today);
        start.setDate(start.getDate() - 6);
        break;
      }
      case 'last30': {
        end = today;
        start = new Date(today);
        start.setDate(start.getDate() - 29);
        break;
      }
      case 'thisMonth': {
        start = new Date(today.getFullYear(), today.getMonth(), 1);
        end = today;
        break;
      }
      case 'thisYear': {
        start = new Date(today.getFullYear(), 0, 1);
        end = today;
        break;
      }
    }
    this.store.dateInitial.set(start);
    this.store.finalDate.set(end);
  }

  readonly formatBytes = formatBytes;
  readonly formatDate = formatDate;
  readonly formatNumber = formatNumber;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
