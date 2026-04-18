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
    <section class="panel" aria-labelledby="filters-title">
      <header class="panel-head">
        <h2 id="filters-title">{{ i18n.t('filters.title') }}</h2>
        <p>{{ i18n.t('filters.subtitle') }}</p>
      </header>

      <div
        class="drop-zone"
        [class.is-dragging]="isDragging()"
        [class.is-processing]="isProcessing()"
        [class.is-failed]="isFailed()"
        [class.is-pending]="!!store.pendingCsv()"
        [class.has-file]="!!store.lastUpload() && !isProcessing() && !isFailed() && !store.pendingCsv()"
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
          <div class="preview" role="group" [attr.aria-label]="i18n.t('filters.preview.title')">
            <header class="preview-head">
              <i class="pi pi-file" aria-hidden="true"></i>
              <strong>{{ i18n.t('filters.preview.title') }}</strong>
            </header>
            <dl class="preview-grid">
              <dt>{{ i18n.t('filters.preview.file') }}</dt>
              <dd>
                <span class="fname">{{ pending.file.name }}</span>
                <span class="fsize">{{ formatBytes(pending.file.size) }}</span>
              </dd>
              <dt>{{ i18n.t('filters.preview.metricId') }}</dt>
              <dd>
                @if (pending.meta.metricId !== null) {
                  <span class="pill">{{ pending.meta.metricId }}</span>
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
            <div class="preview-actions">
              <button
                type="button"
                class="btn ghost"
                (click)="onCancelPending($event)"
              >
                {{ i18n.t('filters.preview.cancel') }}
              </button>
              <button
                type="button"
                class="btn primary"
                (click)="onConfirmPending($event)"
              >
                <i class="pi pi-send" aria-hidden="true"></i>
                {{ i18n.t('filters.preview.confirm') }}
              </button>
            </div>
          </div>
        } @else if (store.uploading()) {
          <div class="drop-content">
            <i class="pi pi-spin pi-spinner"></i>
            <strong>{{ i18n.t('filters.drop.uploading') }}</strong>
          </div>
        } @else if (store.lastUpload()) {
          @if (isProcessing()) {
            <div class="drop-content processing">
              <i class="pi pi-spin pi-cog"></i>
              <strong>{{ i18n.t('filters.drop.processing') }}</strong>
              <small>
                {{ i18n.t('filters.drop.processingHint', {
                  name: store.lastUpload()?.originalName ?? '',
                  count: formatNumber(store.uploadStatus()?.rowsProcessed ?? 0)
                }) }}
              </small>
              <div class="progress-track">
                <span class="progress-bar-indeterminate"></span>
              </div>
            </div>
          } @else if (isFailed()) {
            <div class="drop-content failed">
              <i class="pi pi-exclamation-triangle"></i>
              <strong>{{ i18n.t('filters.drop.failed') }}</strong>
              <small>{{ store.uploadStatus()?.error || i18n.t('filters.drop.unknownError') }}</small>
            </div>
            <button
              type="button"
              class="clear-btn"
              (click)="onClear($event)"
              (keydown.enter)="$event.stopPropagation()"
              (keydown.space)="$event.stopPropagation()"
              [attr.aria-label]="i18n.t('filters.drop.removeFailedAria')"
              [attr.title]="i18n.t('filters.drop.removeTitleShort')"
            >
              <i class="pi pi-times" aria-hidden="true"></i>
            </button>
          } @else {
            <div class="drop-content success">
              <i class="pi pi-check-circle"></i>
              <strong>{{ store.lastUpload()?.originalName }}</strong>
              <small>
                {{ i18n.t('filters.drop.successHint', {
                  size: formatBytes(store.lastUpload()?.size ?? 0),
                  count: formatNumber(store.uploadStatus()?.rowsProcessed ?? 0)
                }) }}
              </small>
            </div>
            <button
              type="button"
              class="clear-btn"
              (click)="onClear($event)"
              (keydown.enter)="$event.stopPropagation()"
              (keydown.space)="$event.stopPropagation()"
              [attr.aria-label]="i18n.t('filters.drop.removeAria')"
              [attr.title]="i18n.t('filters.drop.removeTitle')"
            >
              <i class="pi pi-times" aria-hidden="true"></i>
            </button>
          }
        } @else {
          <div class="drop-content">
            <i class="pi pi-cloud-upload"></i>
            <strong>{{ i18n.t('filters.drop.default') }}</strong>
            <small>{{ i18n.t('filters.drop.defaultHint') }}</small>
          </div>
        }
      </div>

      <div class="divider"></div>

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

      <div class="presets" role="group" [attr.aria-label]="i18n.t('filters.presets.label')">
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
          styleClass="w-full"
        />
        <p-button
          [label]="i18n.t('filters.actions.excel')"
          icon="pi pi-file-excel"
          severity="success"
          [outlined]="true"
          (onClick)="store.baixarExcel()"
          [disabled]="!store.isSubmittable()"
          styleClass="w-full"
        />
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
      .panel-head h2 {
        font-family: 'Nunito', sans-serif;
        font-size: 1.05rem;
        font-weight: 800;
        margin: 0 0 0.2rem;
      }
      .panel-head p {
        margin: 0 0 1.25rem;
        font-size: 0.85rem;
        color: var(--gy-text-soft);
      }

      .drop-zone {
        position: relative;
        border: 2px dashed var(--gy-border);
        background: var(--gy-surface-2);
        border-radius: 12px;
        padding: 1.25rem 1rem;
        text-align: center;
        cursor: pointer;
        transition: border-color 300ms ease, background-color 300ms ease;
        outline: none;
        min-height: 132px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .clear-btn {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        width: 26px;
        height: 26px;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: var(--gy-text-soft);
        display: grid;
        place-items: center;
        cursor: pointer;
        font-size: 0.78rem;
        opacity: 0.55;
        transition: background-color 140ms, color 140ms, opacity 140ms;
      }
      .clear-btn:hover {
        background: rgba(239, 68, 68, 0.1);
        color: #ef4444;
        opacity: 1;
      }
      :root[data-theme='dark'] .clear-btn:hover {
        background: rgba(239, 68, 68, 0.18);
        color: #fca5a5;
      }
      .clear-btn:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring);
        opacity: 1;
      }
      .drop-zone:hover,
      .drop-zone:focus-visible,
      .drop-zone.is-dragging {
        border-color: var(--gy-green);
        background: var(--gy-green-50);
      }
      .drop-zone:focus-visible {
        box-shadow: var(--focus-ring);
      }
      .drop-zone.has-file {
        border-style: solid;
        border-color: var(--gy-green);
        background: var(--gy-green-50);
      }
      /* Processando: fundo + borda amarelos da marca */
      .drop-zone.is-processing {
        border-style: solid;
        border-color: var(--gy-yellow);
        background: var(--gy-yellow-50);
      }
      /* Erro: fundo + borda vermelhos de atencao */
      .drop-zone.is-failed {
        border-style: solid;
        border-color: #ef4444;
        background: #fef2f2;
      }
      :root[data-theme='dark'] .drop-zone.is-failed {
        background: #3a1414;
      }
      /* Preview: o drop-zone vira um cartao de confirmacao, sem
         hover/cursor (o user confirma pelos botoes, nao clicando fora). */
      .drop-zone.is-pending {
        cursor: default;
        border-style: solid;
        border-color: var(--gy-green);
        background: var(--gy-surface);
        padding: 1rem;
        text-align: left;
        display: block;
        min-height: 0;
      }
      .drop-zone.is-pending:hover,
      .drop-zone.is-pending:focus-visible {
        border-color: var(--gy-green);
        background: var(--gy-surface);
        box-shadow: none;
      }
      .preview-head {
        display: flex; align-items: center; gap: 0.45rem;
        margin-bottom: 0.75rem;
      }
      .preview-head i { color: var(--gy-green-dark); font-size: 1rem; }
      :root[data-theme='dark'] .preview-head i { color: var(--gy-green); }
      .preview-head strong {
        font-family: 'Nunito', sans-serif;
        font-size: 0.92rem;
        color: var(--gy-text);
      }
      .preview-grid {
        display: grid;
        grid-template-columns: auto 1fr;
        column-gap: 0.75rem;
        row-gap: 0.4rem;
        margin: 0 0 0.9rem;
      }
      .preview-grid dt {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--gy-text-soft);
        font-weight: 700;
        padding-top: 0.15rem;
      }
      .preview-grid dd {
        margin: 0;
        font-size: 0.85rem;
        color: var(--gy-text);
        display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
      }
      .preview-grid .fname {
        font-weight: 600;
        word-break: break-all;
      }
      .preview-grid .fsize {
        font-size: 0.75rem;
        color: var(--gy-text-soft);
        font-variant-numeric: tabular-nums;
      }
      .preview-grid .pill {
        display: inline-block;
        padding: 0.15rem 0.55rem;
        border-radius: 999px;
        background: var(--gy-green-50);
        color: var(--gy-green-dark);
        font-size: 0.78rem;
        font-weight: 800;
        font-variant-numeric: tabular-nums;
      }
      :root[data-theme='dark'] .preview-grid .pill { color: var(--gy-green); }
      .preview-grid .muted {
        color: var(--gy-text-soft);
        font-style: italic;
        font-size: 0.82rem;
      }
      .preview-actions {
        display: flex; gap: 0.5rem; justify-content: flex-end;
      }
      .preview-actions .btn {
        display: inline-flex; align-items: center; gap: 0.35rem;
        padding: 0.45rem 0.9rem;
        border-radius: 8px;
        font: inherit;
        font-weight: 700;
        font-size: 0.82rem;
        cursor: pointer;
        transition: background 140ms, border-color 140ms, color 140ms;
      }
      .preview-actions .btn.ghost {
        background: transparent;
        border: 1px solid var(--gy-border);
        color: var(--gy-text-soft);
      }
      .preview-actions .btn.ghost:hover {
        background: var(--gy-surface-2);
        color: var(--gy-text);
      }
      .preview-actions .btn.primary {
        background: var(--gy-green-dark);
        border: 1px solid var(--gy-green-dark);
        color: #fff;
      }
      :root[data-theme='dark'] .preview-actions .btn.primary {
        background: var(--gy-green);
        border-color: var(--gy-green);
        color: var(--gy-bg);
      }
      .preview-actions .btn.primary:hover { transform: translateY(-1px); }

      /* Presets de data: chips discretos acima dos campos De/Até */
      .presets {
        display: flex;
        flex-wrap: wrap;
        gap: 0.3rem;
        margin: 0 0 0.75rem;
      }
      .preset-chip {
        background: var(--gy-surface-2);
        border: 1px solid var(--gy-border);
        color: var(--gy-text-soft);
        padding: 0.3rem 0.7rem;
        border-radius: 999px;
        font: inherit;
        font-size: 0.75rem;
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
      .drop-content {
        display: flex; flex-direction: column; align-items: center; gap: 0.25rem;
      }
      .drop-content i {
        font-size: 1.75rem;
        color: var(--gy-green-dark);
        margin-bottom: 0.35rem;
      }
      :root[data-theme='dark'] .drop-content i { color: var(--gy-green); }
      .drop-content strong {
        font-family: 'Nunito', sans-serif;
        font-size: 0.95rem;
        color: var(--gy-text);
      }
      .drop-content small {
        font-size: 0.78rem;
        color: var(--gy-text-soft);
      }
      .drop-content.success strong { color: var(--gy-green-dark); }
      :root[data-theme='dark'] .drop-content.success strong { color: var(--gy-green); }

      /* Estado processing: texto/icone amber p/ combinar com bg amarelo */
      .drop-content.processing strong { color: #92400e; }
      .drop-content.processing i {
        color: #d97706;
        animation-duration: 1.8s;
      }
      :root[data-theme='dark'] .drop-content.processing strong { color: #fcd34d; }
      :root[data-theme='dark'] .drop-content.processing i { color: var(--gy-yellow); }

      .progress-track {
        position: relative;
        width: 100%;
        max-width: 220px;
        height: 3px;
        background: rgba(217, 119, 6, 0.2);
        border-radius: 999px;
        overflow: hidden;
        margin-top: 0.5rem;
      }
      .progress-bar-indeterminate {
        position: absolute;
        top: 0;
        left: 0;
        height: 100%;
        width: 35%;
        background: linear-gradient(
          90deg,
          transparent 0%,
          #d97706 50%,
          transparent 100%
        );
        animation: gy-drop-bar 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
      }
      :root[data-theme='dark'] .progress-bar-indeterminate {
        background: linear-gradient(
          90deg,
          transparent 0%,
          var(--gy-yellow) 50%,
          transparent 100%
        );
      }
      @keyframes gy-drop-bar {
        0%   { transform: translateX(-100%); }
        100% { transform: translateX(380%); }
      }

      /* Estado failed: texto/icone vermelhos p/ combinar com bg */
      .drop-content.failed strong { color: #991b1b; }
      .drop-content.failed i { color: #dc2626; }
      :root[data-theme='dark'] .drop-content.failed strong { color: #fca5a5; }
      :root[data-theme='dark'] .drop-content.failed i { color: #f87171; }

      .divider { height: 1px; background: var(--gy-border); margin: 1.25rem 0; }

      .field { display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 0.9rem; }
      .field label {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--gy-text-soft);
        font-weight: 700;
      }
      .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }

      .actions {
        display: flex; flex-direction: column; gap: 0.5rem;
        margin-top: 1.25rem;
      }
      .hint-missing-upload {
        display: inline-flex; align-items: center; gap: 0.4rem;
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
    `,
  ],
})
export class FiltersPanelComponent {
  readonly store = inject(MetricsStore);
  readonly i18n = inject(I18nService);
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
    if (file) this.store.acceptCsvFile(file);
  }
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.store.acceptCsvFile(file);
    input.value = '';
  }

  onClear(event: MouseEvent): void {
    event.stopPropagation(); // nao abre o file picker
    this.store.clearUpload();
  }

  /**
   * Clique/teclas no drop-zone so' abrem o file picker quando nao ha
   * preview ativa. Em modo preview, o user interage com os botoes
   * "Enviar / Cancelar" — clicar no vazio seria ambiguo.
   */
  onDropZoneClick(event: MouseEvent, input: HTMLInputElement): void {
    if (this.store.pendingCsv()) return;
    // Ignora clicks vindos dos botoes do Cancelar/Remover que borbulharam
    if ((event.target as HTMLElement).closest('.clear-btn, .btn')) return;
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

  /**
   * Calcula o range do preset escolhido e popula os signals de data
   * na store. `new Date()` no momento do click garante que "hoje" é
   * recalculado a cada uso — não fica grudado na hora em que o
   * componente foi criado.
   */
  applyPreset(id: PresetId): void {
    const today = startOfDay(new Date());
    let start: Date;
    let end: Date;
    switch (id) {
      case 'last7': {
        end = today;
        start = new Date(today);
        start.setDate(start.getDate() - 6); // incluindo hoje = 7 dias
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

  // Expostos como propriedades pra serem chamados direto no template.
  readonly formatBytes = formatBytes;
  readonly formatDate = formatDate;
  readonly formatNumber = formatNumber;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
