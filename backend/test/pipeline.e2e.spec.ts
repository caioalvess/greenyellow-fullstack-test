/**
 * E2E do pipeline completo: POST /uploads -> AzuriteStorageEngine -> Rabbit
 * -> CsvConsumerService (no MESMO processo) -> Postgres. Depois valida que
 * /metrics/aggregate e /metrics/report leem os dados persistidos.
 *
 * Isolamento do ambiente de DEV via env vars:
 * - POSTGRES_DB=gy_metrics_test     (banco separado)
 * - BLOB_CONTAINER=csv-uploads-test (container separado no Azurite)
 * - UPLOAD_QUEUE_NAME=csv.uploaded.test (fila separada — dev consumer nao rouba a msg)
 *
 * Essas vars PRECISAM ser setadas ANTES do createTestingModule, pra ConfigModule pegar.
 */

// set env vars before any Nest import
process.env.POSTGRES_DB = 'gy_metrics_test';
process.env.BLOB_CONTAINER = 'csv-uploads-test';
process.env.UPLOAD_QUEUE_NAME = 'csv.uploaded.test';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { Client } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';

async function ensureTestDb(): Promise<void> {
  const admin = new Client({
    host: process.env.POSTGRES_HOST ?? 'postgres',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER ?? 'gy_user',
    password: process.env.POSTGRES_PASSWORD ?? 'gy_password',
    database: 'postgres',
  });
  await admin.connect();
  const { rowCount } = await admin.query(
    'SELECT 1 FROM pg_database WHERE datname = $1',
    [process.env.POSTGRES_DB],
  );
  if (rowCount === 0) {
    await admin.query(`CREATE DATABASE "${process.env.POSTGRES_DB}"`);
  }
  await admin.end();
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 15000,
  intervalMs = 200,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

describe('Pipeline CSV (E2E real)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    await ensureTestDb();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    dataSource = app.get(DataSource);
    await dataSource.query('TRUNCATE metric_readings RESTART IDENTITY');
    await dataSource.query('TRUNCATE csv_uploads');
  }, 45000);

  afterAll(async () => {
    await app?.close();
  });

  it('upload -> consumer -> persist -> aggregate -> report', async () => {
    const csv = [
      'metricId;dateTime;value',
      '42;10/01/2024 00:00;5',
      '42;10/01/2024 06:00;3',
      '42;11/01/2024 00:00;7',
    ].join('\n');

    // 1) Upload: API devolve 201 com blobName gerado pelo storage engine
    const upload = await request(app.getHttpServer())
      .post('/uploads')
      .attach('file', Buffer.from(csv), 'e2e.csv')
      .expect(201);

    expect(upload.body).toEqual(
      expect.objectContaining({
        originalName: 'e2e.csv',
        size: expect.any(Number),
        blobName: expect.stringMatching(/.+-e2e\.csv$/),
      }),
    );

    // 2) Consumer: aguarda as 3 linhas entrarem no banco
    await waitFor(async () => {
      const rows = (await dataSource.query(
        'SELECT COUNT(*)::int AS c FROM metric_readings',
      )) as Array<{ c: number }>;
      return rows[0]?.c === 3;
    });

    // 3) Aggregate DAY
    const aggDay = await request(app.getHttpServer())
      .get('/metrics/aggregate')
      .query({
        metricId: 42,
        dateInitial: '2024-01-01',
        finalDate: '2024-01-31',
        granularity: 'DAY',
      })
      .expect(200);
    expect(aggDay.body).toEqual([
      { date: '2024-01-10', value: 8 }, // 5 + 3
      { date: '2024-01-11', value: 7 },
    ]);

    // 4) Aggregate MONTH
    const aggMonth = await request(app.getHttpServer())
      .get('/metrics/aggregate')
      .query({
        metricId: 42,
        dateInitial: '2024-01-01',
        finalDate: '2024-01-31',
        granularity: 'MONTH',
      })
      .expect(200);
    expect(aggMonth.body).toEqual([{ date: '2024-01-01', value: 15 }]);

    // 5) Report Excel — MIME binario precisa de parser explicito
    const report = await request(app.getHttpServer())
      .get('/metrics/report')
      .query({
        metricId: 42,
        dateInitial: '2024-01-01',
        finalDate: '2024-01-31',
      })
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
        res.on('error', cb);
      })
      .expect(200);
    expect(report.headers['content-type']).toContain(
      'spreadsheetml.sheet',
    );
    expect(report.headers['content-disposition']).toContain('attachment');
    expect(report.headers['content-disposition']).toContain('report-42-');
    const body = report.body as Buffer;
    expect(Buffer.isBuffer(body)).toBe(true);
    // Signature magica do xlsx: PK zip header (xlsx e' um zip)
    expect(body.slice(0, 2).toString()).toBe('PK');
  }, 45000);

  it('validacao preservada: upload de .txt retorna 400', async () => {
    await request(app.getHttpServer())
      .post('/uploads')
      .attach('file', Buffer.from('oi'), 'x.txt')
      .expect(400);
  });

  it('dedup por SHA-256: reenvio do mesmo conteudo retorna 409', async () => {
    const csv = Buffer.from(
      [
        'metricId;dateTime;value',
        '99;01/01/2024 00:00;1',
        '99;02/01/2024 00:00;2',
      ].join('\n'),
    );

    const first = await request(app.getHttpServer())
      .post('/uploads')
      .attach('file', csv, 'dedup.csv')
      .expect(201);
    expect(first.body.originalName).toBe('dedup.csv');

    // Mesmo conteudo, nome diferente — hash e igual, rejeita.
    const second = await request(app.getHttpServer())
      .post('/uploads')
      .attach('file', csv, 'dedup-outro-nome.csv')
      .expect(409);
    expect(second.body.existing).toEqual(
      expect.objectContaining({
        originalName: 'dedup.csv',
        uploadedAt: expect.any(String),
        size: expect.any(Number),
      }),
    );

    // Conteudo diferente por um byte — hash muda, aceita.
    const csvPlus = Buffer.concat([csv, Buffer.from('\n99;03/01/2024 00:00;3')]);
    await request(app.getHttpServer())
      .post('/uploads')
      .attach('file', csvPlus, 'dedup-plus.csv')
      .expect(201);
  }, 20000);

  it('validacao preservada: aggregate com metricId invalido retorna 400', async () => {
    await request(app.getHttpServer())
      .get('/metrics/aggregate')
      .query({
        metricId: 'abc',
        dateInitial: '2024-01-01',
        finalDate: '2024-01-31',
      })
      .expect(400);
  });
});
