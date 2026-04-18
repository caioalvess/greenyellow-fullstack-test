import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, catchError, of, switchMap, timer } from 'rxjs';
import { MessageService } from 'primeng/api';
import { ApiService } from './api.service';
import { CsvMeta, extractCsvMeta } from './csv-meta.util';
import { formatNumber } from './format.util';
import { I18nService } from './i18n/i18n.service';
import { AggregatedPoint, Granularity, UploadStatus } from './models';

/**
 * Arquivo CSV escolhido pelo user aguardando confirmação para upload.
 * Meta e' extraida inline antes de exibir a preview.
 */
export interface PendingCsv {
  file: File;
  meta: CsvMeta;
}

const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 120_000;

export interface UploadedFileMeta {
  originalName: string;
  size: number;
  uploadedAt: string;
}

/**
 * Store centralizado dos estados que FiltersPanel (escrita) e
 * ResultsPanel (leitura) compartilham.
 *
 * Campos do form sao signals escrevíveis (ngModel bindings viram set()).
 * Estado derivado (total, isValid) sao computed signals.
 */
@Injectable({ providedIn: 'root' })
export class MetricsStore {
  // Form state
  readonly metricId = signal<number | null>(null);
  readonly dateInitial = signal<Date | null>(null);
  readonly finalDate = signal<Date | null>(null);
  readonly granularity = signal<Granularity>('DAY');

  // Upload feedback
  readonly lastUpload = signal<UploadedFileMeta | null>(null);
  readonly uploading = signal(false);
  readonly uploadStatus = signal<UploadStatus | null>(null);
  /**
   * Arquivo CSV aguardando confirmacao do usuario antes do upload.
   * null quando o drop-zone esta em estado "vazio", "enviando" ou "enviado".
   */
  readonly pendingCsv = signal<PendingCsv | null>(null);
  private pollSub?: Subscription;

  // Results state
  readonly data = signal<AggregatedPoint[]>([]);
  readonly loading = signal(false);
  readonly searched = signal(false);

  // Derived
  readonly total = computed(() =>
    this.data().reduce((acc, r) => acc + (r.value ?? 0), 0),
  );
  /**
   * KPIs derivados da serie devolvida pelo /aggregate. Sao memorizados
   * como uma unica struct (em vez de 4 computeds separados) pra evitar
   * varrer `data()` 4x a cada mudanca — um unico reduce alimenta todos.
   * Vazio quando data() esta vazio (null nos pontos de pico/minimo) pra
   * a UI saber exibir placeholder em vez de `-Infinity`.
   */
  readonly kpis = computed(() => {
    const rows = this.data();
    if (rows.length === 0) {
      return { avg: 0, max: 0, min: 0, maxDate: null, minDate: null };
    }
    let sum = 0;
    let max = rows[0].value;
    let min = rows[0].value;
    let maxDate = rows[0].date;
    let minDate = rows[0].date;
    for (const r of rows) {
      const v = r.value ?? 0;
      sum += v;
      if (v > max) { max = v; maxDate = r.date; }
      if (v < min) { min = v; minDate = r.date; }
    }
    return {
      avg: Math.round(sum / rows.length),
      max,
      min,
      maxDate,
      minDate,
    };
  });
  readonly isFormValid = computed(
    () =>
      this.metricId() !== null &&
      this.dateInitial() !== null &&
      this.finalDate() !== null,
  );
  /**
   * Habilita os botoes somente quando:
   *  - form esta valido (metricId + datas)
   *  - E existe um CSV ja' enviado
   *
   * Exceção: metricId === 999 e' um dataset de demo pre-seedeado no banco
   * (ver db/seed-demo.sql) — libera sem exigir upload novo pra facilitar
   * demonstracao de paginacao/cenarios com muitos dados.
   */
  readonly isSubmittable = computed(() => {
    if (!this.isFormValid()) return false;
    if (this.metricId() === 999) return true;
    // CSV precisa estar enviado E processamento concluido (ou desconhecido por
    // reload da pagina — nesse caso lastUpload seria null e cairia no false).
    if (this.lastUpload() === null) return false;
    const status = this.uploadStatus();
    if (!status) return false;
    return status.state === 'completed';
  });

  private readonly api = inject(ApiService);
  private readonly messages = inject(MessageService);
  private readonly i18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);

  consultar(): void {
    if (!this.isFormValid()) return;
    this.loading.set(true);
    this.searched.set(true);

    this.api
      .aggregate({
        metricId: this.metricId()!,
        dateInitial: this.toIsoDate(this.dateInitial()!),
        finalDate: this.toIsoDate(this.finalDate()!),
        granularity: this.granularity(),
      })
      .subscribe({
        next: (rows) => {
          this.data.set(rows);
          this.loading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          this.messages.add({
            severity: 'error',
            summary: this.i18n.t('toast.consult.error.title'),
            detail: this.extractError(err),
            life: 7000,
          });
        },
      });
  }

  baixarExcel(): void {
    if (!this.isFormValid()) return;
    const url = this.api.reportUrl({
      metricId: this.metricId()!,
      dateInitial: this.toIsoDate(this.dateInitial()!),
      finalDate: this.toIsoDate(this.finalDate()!),
    });
    window.location.href = url;
    this.messages.add({
      severity: 'info',
      summary: this.i18n.t('toast.report.info.title'),
      detail: this.i18n.t('toast.report.info.detail'),
      life: 4000,
    });
  }

  /**
   * Entrada unica pra um arquivo CSV vindo da UI (dropzone ou file picker).
   *
   * Novo fluxo com preview: em vez de disparar upload automaticamente,
   * extrai meta do CSV e guarda em `pendingCsv` — a UI renderiza uma
   * preview com MetricId/range detectados pro user confirmar. Se a
   * extracao falhar (CSV malformado), pendingCsv ainda é setado com
   * meta vazia — o user pode confirmar mesmo assim (ex.: CSV valido
   * com layout diferente do nosso detector) e o backend sera a fonte
   * de verdade.
   */
  async acceptCsvFile(file: File): Promise<void> {
    if (!file.name.toLowerCase().endsWith('.csv')) return;
    let meta: CsvMeta;
    try {
      meta = await extractCsvMeta(file);
    } catch {
      meta = { metricId: null, firstDate: null, lastDate: null };
    }
    this.pendingCsv.set({ file, meta });
  }

  /**
   * Confirma o upload do pendingCsv: aplica o prefill (metricId + datas)
   * e inicia o upload real. Chamado pelo botao "Enviar" da preview.
   */
  confirmPendingUpload(): void {
    const pending = this.pendingCsv();
    if (!pending) return;
    const { file, meta } = pending;
    if (meta.metricId !== null && meta.firstDate && meta.lastDate) {
      this.prefillFromMeta({
        metricId: meta.metricId,
        firstDate: meta.firstDate,
        lastDate: meta.lastDate,
      });
    }
    this.pendingCsv.set(null);
    this.uploadCsv(file);
  }

  /**
   * Descarta o CSV em preview sem enviar. UI volta pro estado vazio.
   */
  cancelPendingUpload(): void {
    this.pendingCsv.set(null);
  }

  uploadCsv(file: File): void {
    this.uploading.set(true);
    this.uploadStatus.set(null);
    this.stopPolling();

    this.api.uploadCsv(file).subscribe({
      next: (res) => {
        this.uploading.set(false);
        this.lastUpload.set({
          originalName: res.originalName,
          size: res.size,
          uploadedAt: res.uploadedAt,
        });
        this.messages.add({
          severity: 'success',
          summary: this.i18n.t('toast.upload.success.title'),
          detail: this.i18n.t('toast.upload.success.detail', {
            name: res.originalName,
          }),
          life: 4000,
        });
        this.startPolling(res.blobName);
      },
      error: (err) => {
        this.uploading.set(false);
        this.messages.add({
          severity: 'error',
          summary: this.i18n.t('toast.upload.error.title'),
          detail: this.extractError(err),
          life: 7000,
        });
      },
    });
  }

  /**
   * Polling do status de processamento via RxJS timer. Cancela
   * automaticamente quando o status fica terminal (completed/failed),
   * quando estoura timeout, quando um novo upload comeca (stopPolling)
   * ou quando o injector root e' destruido (takeUntilDestroyed).
   *
   * Erros de tick individual (ex.: 404 transitorio enquanto a mensagem
   * ainda nao foi consumida) sao silenciados com catchError -> of(null).
   */
  private startPolling(blobName: string): void {
    this.stopPolling();
    const startedAt = Date.now();

    this.pollSub = timer(0, POLL_INTERVAL_MS)
      .pipe(
        switchMap(() =>
          this.api
            .getUploadStatus(blobName)
            .pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((status) => {
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          this.stopPolling();
          this.messages.add({
            severity: 'warn',
            summary: this.i18n.t('toast.process.slow.title'),
            detail: this.i18n.t('toast.process.slow.detail'),
            life: 8000,
          });
          return;
        }
        if (!status) return; // tick com erro transitorio — ignora
        this.uploadStatus.set(status);
        if (status.state === 'completed') {
          this.stopPolling();
          this.messages.add({
            severity: 'success',
            summary: this.i18n.t('toast.process.success.title'),
            detail: this.i18n.t('toast.process.success.detail', {
              count: formatNumber(status.rowsProcessed),
            }),
            life: 4000,
          });
        } else if (status.state === 'failed') {
          this.stopPolling();
          this.messages.add({
            severity: 'error',
            summary: this.i18n.t('toast.process.failed.title'),
            detail: status.error ?? this.i18n.t('toast.process.unknownError'),
            life: 8000,
          });
        }
      });
  }

  private stopPolling(): void {
    this.pollSub?.unsubscribe();
    this.pollSub = undefined;
  }

  prefillFromMeta(meta: {
    metricId: number;
    firstDate: Date;
    lastDate: Date;
  }): void {
    this.metricId.set(meta.metricId);
    this.dateInitial.set(meta.firstDate);
    this.finalDate.set(meta.lastDate);
  }

  /**
   * Limpa apenas o indicador de upload no client — o blob permanece no
   * Azurite (nao ha delete remoto, porque o consumer pode ainda estar
   * processando). O efeito é voltar os botoes pro estado "precisa de CSV".
   */
  clearUpload(): void {
    const removed = this.lastUpload();
    this.stopPolling();
    this.lastUpload.set(null);
    this.uploadStatus.set(null);
    if (removed) {
      this.messages.add({
        severity: 'info',
        summary: this.i18n.t('toast.upload.removed.title'),
        detail: removed.originalName,
        life: 3000,
      });
    }
  }

  private toIsoDate(d: Date): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private extractError(err: {
    error?: { message?: string | string[] };
    status?: number;
  }): string {
    const msg = err?.error?.message;
    if (Array.isArray(msg)) return msg.join('; ');
    if (typeof msg === 'string') return msg;
    return this.i18n.t('toast.consult.error.httpFallback', {
      status: err?.status ?? '?',
    });
  }
}
