import { TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { MessageService } from 'primeng/api';
import { ApiService } from './api.service';
import { MetricsStore } from './metrics.store';
import { I18nService } from './i18n/i18n.service';
import { UploadStatus, UploadState } from './models';

// Helper pra montar UploadStatus sem precisar setar blobName/error em todo lugar.
const status = (
  state: UploadState,
  rowsProcessed: number,
  error: string | null = null,
): UploadStatus => ({
  blobName: 'abc.csv',
  state,
  rowsProcessed,
  error,
});

describe('MetricsStore', () => {
  let store: MetricsStore;
  let api: jest.Mocked<ApiService>;
  let messages: { add: jest.Mock };

  beforeEach(() => {
    api = {
      uploadCsv: jest.fn(),
      aggregate: jest.fn(),
      getUploadStatus: jest.fn(),
      reportUrl: jest.fn().mockReturnValue(''),
    } as unknown as jest.Mocked<ApiService>;
    messages = { add: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        MetricsStore,
        { provide: ApiService, useValue: api },
        { provide: MessageService, useValue: messages },
      ],
    });
    // Fixa o idioma em pt-BR pras asserções baterem com as strings
    // canônicas do dicionário — `navigator.language` no jsdom pode variar
    // e cair em outro idioma no readInitial().
    TestBed.inject(I18nService).setLocale('pt');
    store = TestBed.inject(MetricsStore);
  });

  // ------------------------------------------------------------------
  // Computeds
  // ------------------------------------------------------------------
  describe('isFormValid', () => {
    it('true somente quando metricId + dateInitial + finalDate preenchidos', () => {
      expect(store.isFormValid()).toBe(false);
      store.metricId.set(100);
      expect(store.isFormValid()).toBe(false);
      store.dateInitial.set(new Date(2024, 0, 1));
      expect(store.isFormValid()).toBe(false);
      store.finalDate.set(new Date(2024, 0, 31));
      expect(store.isFormValid()).toBe(true);
    });
  });

  describe('isSubmittable', () => {
    const fillForm = (id = 100) => {
      store.metricId.set(id);
      store.dateInitial.set(new Date(2024, 0, 1));
      store.finalDate.set(new Date(2024, 0, 31));
    };

    it('false quando form invalido', () => {
      expect(store.isSubmittable()).toBe(false);
    });

    it('metricId=999 libera sem precisar de upload (excecao do dataset demo)', () => {
      fillForm(999);
      expect(store.isSubmittable()).toBe(true);
    });

    it('outras metrics exigem lastUpload + status completed', () => {
      fillForm(100);
      expect(store.isSubmittable()).toBe(false);

      store.lastUpload.set({
        originalName: 'x.csv',
        size: 10,
        uploadedAt: '',
      });
      expect(store.isSubmittable()).toBe(false); // sem status

      store.uploadStatus.set(status('processing', 10));
      expect(store.isSubmittable()).toBe(false); // processando

      store.uploadStatus.set(status('completed', 10));
      expect(store.isSubmittable()).toBe(true);
    });
  });

  describe('total', () => {
    it('soma os values do data()', () => {
      store.data.set([
        { date: '2024-01-01', value: 5 },
        { date: '2024-01-02', value: 3 },
        { date: '2024-01-03', value: 0 },
      ]);
      expect(store.total()).toBe(8);
    });
  });

  describe('kpis', () => {
    it('zera quando data() esta vazio (sem -Infinity nos maximos)', () => {
      expect(store.kpis()).toEqual({
        avg: 0, max: 0, min: 0, maxDate: null, minDate: null,
      });
    });

    it('devolve avg/max/min + datas de pico e mínimo', () => {
      store.data.set([
        { date: '2024-01-01', value: 10 },
        { date: '2024-01-02', value: 40 }, // pico
        { date: '2024-01-03', value: 5 },  // mínimo
        { date: '2024-01-04', value: 25 },
      ]);
      expect(store.kpis()).toEqual({
        avg: 20, // (10+40+5+25)/4 = 20
        max: 40,
        min: 5,
        maxDate: '2024-01-02',
        minDate: '2024-01-03',
      });
    });

    it('quando ha empate no pico, mantem a primeira ocorrencia', () => {
      store.data.set([
        { date: '2024-01-01', value: 10 },
        { date: '2024-01-02', value: 10 },
      ]);
      expect(store.kpis().maxDate).toBe('2024-01-01');
      expect(store.kpis().minDate).toBe('2024-01-01');
    });
  });

  // ------------------------------------------------------------------
  // acceptCsvFile
  // ------------------------------------------------------------------
  describe('acceptCsvFile', () => {
    it('ignora arquivos que nao sao .csv', async () => {
      await store.acceptCsvFile(new File(['x'], 'foo.txt'));
      expect(store.pendingCsv()).toBeNull();
      expect(api.uploadCsv).not.toHaveBeenCalled();
    });

    it('aceita .csv e .CSV (case insensitive) — seta pendingCsv sem enviar', async () => {
      await store.acceptCsvFile(new File(['x'], 'data.csv'));
      expect(store.pendingCsv()?.file.name).toBe('data.csv');
      await store.acceptCsvFile(new File(['x'], 'DATA.CSV'));
      expect(store.pendingCsv()?.file.name).toBe('DATA.CSV');
      // upload so' acontece quando confirmPendingUpload e' chamado
      expect(api.uploadCsv).not.toHaveBeenCalled();
    });
  });

  describe('pending upload (preview)', () => {
    it('confirmPendingUpload: aplica prefill e inicia upload', () => {
      api.uploadCsv.mockReturnValue(new Subject());
      store.pendingCsv.set({
        file: new File(['x'], 'data.csv'),
        meta: {
          metricId: 42,
          firstDate: new Date(2024, 0, 1),
          lastDate: new Date(2024, 0, 31),
        },
      });

      store.confirmPendingUpload();

      expect(store.metricId()).toBe(42);
      expect(store.dateInitial()?.getDate()).toBe(1);
      expect(store.finalDate()?.getDate()).toBe(31);
      expect(store.pendingCsv()).toBeNull();
      expect(api.uploadCsv).toHaveBeenCalled();
    });

    it('confirmPendingUpload: meta vazia nao sobrescreve o form atual', () => {
      api.uploadCsv.mockReturnValue(new Subject());
      store.metricId.set(77);
      store.pendingCsv.set({
        file: new File(['x'], 'data.csv'),
        meta: { metricId: null, firstDate: null, lastDate: null },
      });

      store.confirmPendingUpload();

      expect(store.metricId()).toBe(77);
      expect(api.uploadCsv).toHaveBeenCalled();
    });

    it('confirmPendingUpload: no-op quando nao ha pending', () => {
      store.confirmPendingUpload();
      expect(api.uploadCsv).not.toHaveBeenCalled();
    });

    it('cancelPendingUpload: zera pendingCsv sem chamar API', () => {
      store.pendingCsv.set({
        file: new File(['x'], 'data.csv'),
        meta: { metricId: null, firstDate: null, lastDate: null },
      });

      store.cancelPendingUpload();

      expect(store.pendingCsv()).toBeNull();
      expect(api.uploadCsv).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // uploadCsv
  // ------------------------------------------------------------------
  describe('uploadCsv', () => {
    const uploadResponse = {
      blobName: 'abc.csv',
      originalName: 'data.csv',
      size: 1024,
      uploadedAt: '2024-01-01T00:00:00Z',
    };

    it('sucesso: seta lastUpload, zera uploading, toca success, inicia polling', fakeAsync(() => {
      api.uploadCsv.mockReturnValue(of(uploadResponse));
      api.getUploadStatus.mockReturnValue(new Subject()); // nunca completa

      store.uploadCsv(new File(['x'], 'data.csv'));

      expect(store.uploading()).toBe(false);
      expect(store.lastUpload()).toEqual({
        originalName: 'data.csv',
        size: 1024,
        uploadedAt: '2024-01-01T00:00:00Z',
      });
      expect(messages.add).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'success',
          summary: 'Upload concluído',
        }),
      );

      // timer(0, 500) dispara imediatamente e chama getUploadStatus
      tick(1);
      expect(api.getUploadStatus).toHaveBeenCalledWith('abc.csv');

      // para o timer infinito — evita 'periodic timer(s) still in the queue'
      store.clearUpload();
      flush();
    }));

    it('erro: zera uploading, nao chama polling, toca error', () => {
      api.uploadCsv.mockReturnValue(
        throwError(() => ({
          error: { message: 'Arquivo invalido' },
          status: 400,
        })),
      );

      store.uploadCsv(new File(['x'], 'bad.csv'));

      expect(store.uploading()).toBe(false);
      expect(store.lastUpload()).toBeNull();
      expect(api.getUploadStatus).not.toHaveBeenCalled();
      expect(messages.add).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'error',
          summary: 'Falha no upload',
          detail: 'Arquivo invalido',
        }),
      );
    });
  });

  // ------------------------------------------------------------------
  // Polling
  // ------------------------------------------------------------------
  describe('polling', () => {
    const startUpload = () => {
      api.uploadCsv.mockReturnValue(
        of({
          blobName: 'abc.csv',
          originalName: 'data.csv',
          size: 1,
          uploadedAt: '',
        }),
      );
      store.uploadCsv(new File(['x'], 'data.csv'));
    };

    it('status completed: atualiza uploadStatus, toca success, para polling', fakeAsync(() => {
      api.getUploadStatus.mockReturnValue(of(status('completed', 12345)));

      startUpload();
      tick(1); // primeiro tick do timer

      expect(store.uploadStatus()).toEqual(status('completed', 12345));
      expect(messages.add).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'success',
          summary: 'Processamento concluído',
          detail: expect.stringContaining('12.345'),
        }),
      );

      // apos completed o poll parou: avancar o tempo nao deve chamar api denovo
      const callsAntes = api.getUploadStatus.mock.calls.length;
      tick(600);
      expect(api.getUploadStatus.mock.calls.length).toBe(callsAntes);
    }));

    it('status failed: atualiza status, toca error, para polling', fakeAsync(() => {
      api.getUploadStatus.mockReturnValue(of(status('failed', 0, 'boom')));

      startUpload();
      tick(1);

      expect(store.uploadStatus()?.state).toBe('failed');
      expect(messages.add).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'error',
          summary: 'Falha no processamento',
          detail: 'boom',
        }),
      );
    }));

    it('404 transitorio num tick nao derruba o polling', fakeAsync(() => {
      let calls = 0;
      api.getUploadStatus.mockImplementation(() => {
        calls += 1;
        if (calls === 1) return throwError(() => new Error('404'));
        return of(status('completed', 1));
      });

      startUpload();
      tick(1); // primeiro tick: erro silenciado, status continua null
      expect(store.uploadStatus()).toBeNull();

      tick(500); // segundo tick: sucesso
      expect(store.uploadStatus()?.state).toBe('completed');
    }));
  });

  // ------------------------------------------------------------------
  // clearUpload
  // ------------------------------------------------------------------
  describe('clearUpload', () => {
    it('reseta lastUpload + uploadStatus e toca toast info', () => {
      store.lastUpload.set({
        originalName: 'x.csv',
        size: 0,
        uploadedAt: '',
      });
      store.uploadStatus.set(status('processing', 10));

      store.clearUpload();

      expect(store.lastUpload()).toBeNull();
      expect(store.uploadStatus()).toBeNull();
      expect(messages.add).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'info',
          summary: 'Arquivo removido',
          detail: 'x.csv',
        }),
      );
    });

    it('sem upload anterior: nao dispara toast', () => {
      store.clearUpload();
      expect(messages.add).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // consultar
  // ------------------------------------------------------------------
  describe('consultar', () => {
    const fillForm = () => {
      store.metricId.set(42);
      store.dateInitial.set(new Date(2024, 0, 1));
      store.finalDate.set(new Date(2024, 0, 31));
      store.granularity.set('DAY');
    };

    it('no-op quando o form e invalido', () => {
      store.consultar();
      expect(api.aggregate).not.toHaveBeenCalled();
    });

    it('sucesso: popula data, marca searched=true, loading=false', () => {
      fillForm();
      const rows = [
        { date: '2024-01-10', value: 7 },
        { date: '2024-01-11', value: 5 },
      ];
      api.aggregate.mockReturnValue(of(rows));

      store.consultar();

      expect(api.aggregate).toHaveBeenCalledWith({
        metricId: 42,
        dateInitial: '2024-01-01',
        finalDate: '2024-01-31',
        granularity: 'DAY',
      });
      expect(store.data()).toEqual(rows);
      expect(store.loading()).toBe(false);
      expect(store.searched()).toBe(true);
    });

    it('erro: mantem loading=false e toca error com mensagem extraida', () => {
      fillForm();
      api.aggregate.mockReturnValue(
        throwError(() => ({
          error: { message: ['Range invalido', 'MetricId obrigatorio'] },
          status: 400,
        })),
      );

      store.consultar();

      expect(store.loading()).toBe(false);
      expect(messages.add).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'error',
          summary: 'Falha na consulta',
          detail: 'Range invalido; MetricId obrigatorio',
        }),
      );
    });
  });
});
