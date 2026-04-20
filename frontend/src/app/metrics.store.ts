import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
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

/**
 * Chave do localStorage pro snapshot da sessao. Versionada (`.v1`) pra
 * que mudancas no shape do snapshot invalidem dados antigos sem risco
 * de crash em runtime — se um usuario com storage legado abrir a app,
 * readSession() retorna null via parse defensivo e a sessao comeca
 * vazia.
 */
const SESSION_STORAGE_KEY = 'gy.metrics.session.v1';

interface PersistedSession {
  metricId: number | null;
  dateInitial: string | null; // ISO 8601
  finalDate: string | null;
  granularity: Granularity;
  lastUpload: UploadedFileMeta | null;
  uploadStatus: UploadStatus | null;
  lastQuery: {
    metricId: number;
    dateInitial: string;
    finalDate: string;
    granularity: Granularity;
    uploadName: string | null;
  } | null;
}

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
  /**
   * Snapshot do que gerou o `data()` atual: metricId + range + gran +
   * nome do arquivo que estava ativo. Usado pra detectar quando os
   * resultados em tela estao "stale" (ex.: user trocou o CSV sem refazer
   * a consulta). Null antes da primeira consulta concluida.
   */
  readonly lastQuery = signal<{
    metricId: number;
    dateInitial: string;
    finalDate: string;
    granularity: Granularity;
    uploadName: string | null;
  } | null>(null);

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

  /**
   * Histograma em 8 faixas dos valores agregados. Calculado client-side
   * sobre o mesmo `data()` — nao exige nova chamada de API. Retorna null
   * quando nao ha dado (UI mostra placeholder).
   */
  readonly histogram = computed(() => {
    const vs = this.data().map((r) => r.value ?? 0);
    if (vs.length === 0) return null;
    const lo = Math.min(...vs);
    const hi = Math.max(...vs);
    if (lo === hi) {
      return { labels: [String(lo)], counts: [vs.length] };
    }
    const bins = 8;
    const step = (hi - lo) / bins;
    const counts = new Array<number>(bins).fill(0);
    const labels: string[] = [];
    for (let i = 0; i < bins; i += 1) {
      labels.push(String(Math.round(lo + i * step)));
    }
    for (const v of vs) {
      const idx = Math.min(bins - 1, Math.floor((v - lo) / step));
      counts[idx] += 1;
    }
    return { labels, counts };
  });

  /**
   * Media por dia-da-semana (indice 0=Dom .. 6=Sab). So' faz sentido
   * quando granularity === DAY — pra MONTH/YEAR devolve null, a UI
   * esconde o painel nesses casos. Parse do ISO date e' manual pra
   * evitar o off-by-one do `new Date('YYYY-MM-DD')` em timezones
   * negativos.
   */
  readonly weekdayMeans = computed<number[] | null>(() => {
    if (this.granularity() !== 'DAY') return null;
    const rows = this.data();
    if (rows.length === 0) return null;
    const sum = new Array<number>(7).fill(0);
    const cnt = new Array<number>(7).fill(0);
    for (const r of rows) {
      const [y, m, d] = r.date.split('-').map(Number);
      const dow = new Date(y, m - 1, d).getDay();
      sum[dow] += r.value ?? 0;
      cnt[dow] += 1;
    }
    return sum.map((s, i) => (cnt[i] ? Math.round(s / cnt[i]) : 0));
  });

  readonly isFormValid = computed(
    () =>
      this.metricId() !== null &&
      this.dateInitial() !== null &&
      this.finalDate() !== null,
  );
  /**
   * Habilita os botoes quando:
   *  - form esta valido (metricId + datas); E
   *  - o sistema ja' tem dado no banco, o que e' verdade quando qualquer
   *    uma das condicoes abaixo e' satisfeita:
   *      1. lastQuery !== null — ja' houve uma consulta bem-sucedida
   *         nesta sessao (ou restaurada do localStorage). O banco e'
   *         cumulativo, entao dado antigo continua la. Removar o
   *         arquivo do dropzone nao apaga nada do banco — so' limpa a
   *         UI — logo a consulta seguinte deve funcionar.
   *      2. lastUpload existe + status == completed — upload pronto
   *         nesta sessao (primeira consulta antes de qualquer refetch).
   *      3. metricId === 999 — exceção do dataset de demo pre-seedeado
   *         (ver db/seed-demo.sql), libera sem exigir upload.
   */
  readonly isSubmittable = computed(() => {
    if (!this.isFormValid()) return false;
    if (this.metricId() === 999) return true;
    if (this.lastQuery() !== null) return true;
    if (this.lastUpload() === null) return false;
    const status = this.uploadStatus();
    if (!status) return false;
    return status.state === 'completed';
  });

  /**
   * Banner "resultados desatualizados". Dispara quando o arquivo
   * ATUALMENTE ENVIADO (lastUpload) difere do arquivo que gerou a
   * consulta em tela (lastQuery.uploadName). Ou seja: o user subiu um
   * CSV novo mas ainda nao clicou em "Consultar" — a tela mostra dado
   * antigo e precisa ser refrescada.
   *
   * Preview (pendingCsv) NAO conta: enquanto o arquivo esta apenas em
   * pre-visualizacao, o user ainda nao se comprometeu com ele, entao a
   * consulta em tela ainda e' valida. Mexer em datas/metricId/granularidade
   * tambem nao dispara o banner (ruidoso demais durante a edicao do form).
   * lastUpload=null (arquivo removido do dropzone) tambem nao conta: o
   * banco cumulativo nao apaga dado, entao a consulta anterior continua
   * batendo com o que esta la.
   */
  readonly isStale = computed(() => {
    const q = this.lastQuery();
    if (!q) return false;
    if (this.loading()) return false;
    // Sem dado em tela, nao existe "consulta" pra estar desatualizada —
    // cobre o caso de aggregate ter devolvido array vazio (ex.: apos um
    // reset ou DB limpa com lastQuery persistida no localStorage).
    if (this.data().length === 0) return false;
    const uploaded = this.lastUpload()?.originalName ?? null;
    if (uploaded === null) return false;
    return uploaded !== q.uploadName;
  });

  private readonly api = inject(ApiService);
  private readonly messages = inject(MessageService);
  private readonly i18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // Ordem importa: hidrata os signals ANTES de registrar o effect de
    // persistencia, senao o primeiro write do effect gravaria o estado
    // zerado por cima do que estava salvo. Setar signals durante hidrate
    // nao dispara o effect nesse ponto porque ele so' e' criado depois.
    this.hydrateFromStorage();
    this.setupSessionPersistence();
  }

  consultar(): void {
    if (!this.isFormValid()) return;

    // MetricId 999 e' o demo seed pre-populado no banco — nao depende
    // de arquivo. Se o user tem um CSV em preview ou ja' enviado e
    // decide consultar 999, limpa o arquivo antes: os resultados vem
    // do seed, o arquivo em tela so' confundiria.
    if (this.metricId() === 999) {
      if (this.pendingCsv()) this.cancelPendingUpload();
      if (this.lastUpload()) this.clearUpload();
      this.runAggregate();
      return;
    }

    // Se ha CSV em pre-visualizacao, "Consultar" comita o upload antes
    // (mesmo fluxo do botao "Enviar" na preview). Isso faz com que o
    // banner "Resultados desatualizados > Refazer consulta" e o botao
    // "Consultar" da sidebar tenham o mesmo comportamento: dedup por
    // hash roda naturalmente — arquivo igual cai em 409 (toast warn
    // + drop limpo), arquivo novo cai em 201 (polling inicia). A query
    // dispara em seguida, refletindo o estado corrente do banco (nao
    // muda em 409; em 201, o user precisa re-consultar apos o processing
    // terminar pra ver os dados novos, mas a UI do dropzone ja sinaliza
    // o processamento em andamento).
    if (this.pendingCsv()) {
      this.confirmPendingUpload();
    }

    this.runAggregate();
  }

  private runAggregate(): void {
    this.loading.set(true);
    this.searched.set(true);

    const query = {
      metricId: this.metricId()!,
      dateInitial: this.toIsoDate(this.dateInitial()!),
      finalDate: this.toIsoDate(this.finalDate()!),
      granularity: this.granularity(),
    };
    const uploadName = this.lastUpload()?.originalName ?? null;

    this.api
      .aggregate(query)
      .subscribe({
        next: (rows) => {
          this.data.set(rows);
          this.lastQuery.set({ ...query, uploadName });
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
      meta = { metricId: null, firstDate: null, lastDate: null, rowCount: null };
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
        // 409: arquivo com SHA-256 identico ja' foi enviado. O backend
        // devolve `{existing: {originalName, uploadedAt, size}}` — toast
        // especifico avisa o usuario sem poluir o fluxo de erro generico.
        if (err?.status === 409 && err?.error?.existing?.originalName) {
          this.messages.add({
            severity: 'warn',
            summary: this.i18n.t('toast.upload.duplicate.title'),
            detail: this.i18n.t('toast.upload.duplicate.detail', {
              name: err.error.existing.originalName,
            }),
            life: 7000,
          });
          return;
        }
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

  /**
   * Le o snapshot da sessao do localStorage (se houver) e popula os
   * signals com o que o user tinha antes do reload. Se havia uma consulta
   * anterior, dispara um GET /metrics/aggregate pra recarregar os dados
   * — o banco e' a fonte de verdade, nao armazenamos o array `data` em
   * disco. Em falha silenciosa (quota, JSON corrompido, etc) ignora e
   * comeca com sessao vazia.
   */
  private hydrateFromStorage(): void {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(SESSION_STORAGE_KEY);
    } catch {
      return; // storage indisponivel (SSR, sandbox, etc)
    }
    if (!raw) return;

    let s: Partial<PersistedSession>;
    try {
      s = JSON.parse(raw) as Partial<PersistedSession>;
    } catch {
      return; // JSON corrompido — deixa o effect sobrescrever
    }

    if (typeof s.metricId === 'number') this.metricId.set(s.metricId);
    if (s.dateInitial) {
      const d = new Date(s.dateInitial);
      if (!Number.isNaN(d.valueOf())) this.dateInitial.set(d);
    }
    if (s.finalDate) {
      const d = new Date(s.finalDate);
      if (!Number.isNaN(d.valueOf())) this.finalDate.set(d);
    }
    if (s.granularity === 'DAY' || s.granularity === 'MONTH' || s.granularity === 'YEAR') {
      this.granularity.set(s.granularity);
    }
    if (s.lastUpload) this.lastUpload.set(s.lastUpload);
    if (s.uploadStatus) this.uploadStatus.set(s.uploadStatus);

    if (s.lastQuery) {
      this.lastQuery.set(s.lastQuery);
      this.searched.set(true);
      this.loading.set(true);
      this.api
        .aggregate({
          metricId: s.lastQuery.metricId,
          dateInitial: s.lastQuery.dateInitial,
          finalDate: s.lastQuery.finalDate,
          granularity: s.lastQuery.granularity,
        })
        .subscribe({
          next: (rows) => {
            this.data.set(rows);
            this.loading.set(false);
          },
          error: () => {
            // Usuario nao disparou nada — nao mostra toast pra nao ruido.
            // Apenas libera o loading; a UI cai no estado "sem dados" e o
            // banner de stale/nova consulta guia o proximo passo.
            this.loading.set(false);
          },
        });
    }
  }

  /**
   * Effect que serializa o estado relevante da sessao no localStorage a
   * cada mudanca nos signals lidos. Roda uma vez na criacao pra tracar
   * dependencias, entao sob demanda. Array `data` e' propositalmente
   * excluido — re-fetchamos no hydrate pra garantir consistencia com o
   * banco.
   */
  private setupSessionPersistence(): void {
    effect(() => {
      const snapshot: PersistedSession = {
        metricId: this.metricId(),
        dateInitial: this.dateInitial()?.toISOString() ?? null,
        finalDate: this.finalDate()?.toISOString() ?? null,
        granularity: this.granularity(),
        lastUpload: this.lastUpload(),
        uploadStatus: this.uploadStatus(),
        lastQuery: this.lastQuery(),
      };
      try {
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(snapshot));
      } catch {
        // quota excedida ou storage readonly — ignora; a sessao vive em
        // memoria nesse render e some no proximo reload.
      }
    });
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
