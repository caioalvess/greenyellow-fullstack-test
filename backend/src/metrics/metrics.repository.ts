import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { ParsedRow } from './csv-parser.util';
import { Granularity } from './dto/aggregate-query.dto';

const GRANULARITY_TO_PG: Record<Granularity, string> = {
  [Granularity.DAY]: 'day',
  [Granularity.MONTH]: 'month',
  [Granularity.YEAR]: 'year',
};

export type AggregatedPoint = {
  date: string;
  value: number;
};

export type ReportRow = {
  metricId: number;
  dateTime: string;
  aggDay: number;
  aggMonth: number;
  aggYear: number;
};

export interface ActiveUpload {
  id: string;
  blobName: string;
  originalName: string;
}

@Injectable()
export class MetricsRepository {
  private readonly logger = new Logger(MetricsRepository.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Insere UM lote de leituras atomicamente, amarrado ao csv_upload_id
   * da origem. ON CONFLICT DO NOTHING torna o processamento idempotente
   * — reenvio ou requeue do mesmo blob reusa o mesmo upload_id, entao
   * colisao em (metric_id, date_time, csv_upload_id) e' ignorada.
   *
   * csvUploadId null so' e' usado em contextos de teste que inserem
   * rows sinteticas sem passar pelo pipeline — em produçao o consumer
   * sempre passa o id do csv_uploads que disparou o batch.
   */
  async insertBatch(
    rows: ParsedRow[],
    csvUploadId: string | null,
  ): Promise<number> {
    if (rows.length === 0) return 0;

    const placeholders: string[] = [];
    const params: unknown[] = [csvUploadId];
    rows.forEach((row, idx) => {
      const offset = idx * 3 + 1;
      placeholders.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $1)`,
      );
      params.push(row.metricId, row.dateTime, row.value);
    });

    const sql = `
      INSERT INTO metric_readings (metric_id, date_time, value, csv_upload_id)
      VALUES ${placeholders.join(',')}
      ON CONFLICT (metric_id, date_time, csv_upload_id) DO NOTHING
      RETURNING id
    `;

    const result = (await this.dataSource.query(sql, params)) as unknown[];
    return result.length;
  }

  async countAll(): Promise<number> {
    const rows = (await this.dataSource.query(
      'SELECT COUNT(*)::int AS count FROM metric_readings',
    )) as { count: number }[];
    return rows[0]?.count ?? 0;
  }

  /**
   * Devolve o upload "ativo" — o mais recente da tabela csv_uploads.
   * Null quando o banco esta vazio (nenhum upload feito ainda). O seed
   * demo nao entra aqui: ele nao tem linha em csv_uploads, suas rows
   * vivem com csv_upload_id=NULL e sao sempre incluidas nas queries.
   */
  async getActiveUpload(): Promise<ActiveUpload | null> {
    const rows = (await this.dataSource.query(
      `SELECT id, blob_name AS "blobName", original_name AS "originalName"
       FROM csv_uploads
       ORDER BY uploaded_at DESC
       LIMIT 1`,
    )) as ActiveUpload[];
    return rows[0] ?? null;
  }

  /**
   * Substituicao tardia: garante que apenas o upload ativo (mais
   * recente) sobrevive. Apaga linhas de `metric_readings` amarradas a
   * uploads antigos E as proprias linhas antigas de `csv_uploads`.
   * Idempotente — se ja so existe um upload, nao faz nada.
   *
   * Roda sempre no comeco de aggregate/report pra atender o requisito:
   * "dados do banco relacionados ao arquivo so vao ser substituidos no
   * ato da consulta". Rows com csv_upload_id IS NULL (seed) sao
   * preservadas.
   */
  async cleanupStaleUploads(): Promise<{
    deletedReadings: number;
    deletedUploads: number;
  }> {
    const active = await this.getActiveUpload();
    if (!active) {
      return { deletedReadings: 0, deletedUploads: 0 };
    }

    // `dataSource.query()` com DELETE RETURNING retorna `[rows, affected]`
    // no driver pg — a segunda posicao e' o inteiro de linhas afetadas.
    // Extraimos dai o count pra nao depender do shape da lista de rows.
    const [, readingsAffected] = (await this.dataSource.query(
      `DELETE FROM metric_readings
       WHERE csv_upload_id IS NOT NULL
         AND csv_upload_id <> $1::uuid`,
      [active.id],
    )) as [unknown, number];

    const [, uploadsAffected] = (await this.dataSource.query(
      `DELETE FROM csv_uploads WHERE id <> $1::uuid`,
      [active.id],
    )) as [unknown, number];

    if (readingsAffected > 0 || uploadsAffected > 0) {
      this.logger.log(
        `🧹 cleanup → removidas ${readingsAffected} leitura(s) e ${uploadsAffected} upload(s) antigo(s) (ativo = ${active.originalName})`,
      );
    }

    return {
      deletedReadings: readingsAffected,
      deletedUploads: uploadsAffected,
    };
  }

  async aggregate(params: {
    metricId: number;
    dateInitial: string;
    finalDate: string;
    granularity: Granularity;
  }): Promise<AggregatedPoint[]> {
    await this.cleanupStaleUploads();

    const trunc = GRANULARITY_TO_PG[params.granularity];
    const sql = `
      SELECT
        to_char(date_trunc($1, date_time), 'YYYY-MM-DD') AS date,
        SUM(value)::int AS value
      FROM metric_readings
      WHERE metric_id = $2
        AND date_time >= $3::date
        AND date_time <  ($4::date + INTERVAL '1 day')
      GROUP BY 1
      ORDER BY 1
    `;
    return this.dataSource.query(sql, [
      trunc,
      params.metricId,
      params.dateInitial,
      params.finalDate,
    ]);
  }

  /**
   * Relatorio formato enunciado item 8.
   *
   * Shape: UMA linha POR LEITURA original (nao agrupa por dia). Colunas:
   *   - metricId: id da metrica
   *   - dateTime: data da leitura (YYYY-MM-DD)
   *   - aggDay:   sum(value) do dia daquela leitura
   *   - aggMonth: sum(value) do mes calendario daquela leitura
   *   - aggYear:  sum(value) do ano calendario daquela leitura
   *
   * O range `dateInitial`/`finalDate` faz parte da assinatura por simetria
   * com o aggregate endpoint, mas NAO filtra linhas no relatorio — o
   * enunciado mostra datas fora do range nos exemplos (ex.: input Nov-Dez
   * 2023 e output contendo 01/01/2024). O relatorio devolve o historico
   * inteiro da metric com as agregacoes de cada leitura.
   *
   * Janelas com SUM(value) OVER (PARTITION BY metric, trunc_day/month/year)
   * dao a mesma agregacao em cada linha do mesmo dia/mes/ano sem precisar
   * de GROUP BY.
   */
  async report(params: {
    metricId: number;
    dateInitial: string;
    finalDate: string;
  }): Promise<ReportRow[]> {
    await this.cleanupStaleUploads();

    void params.dateInitial;
    void params.finalDate;
    const sql = `
      SELECT
        metric_id                            AS "metricId",
        to_char(date_time, 'YYYY-MM-DD')     AS "dateTime",
        SUM(value) OVER (
          PARTITION BY metric_id, date_trunc('day', date_time)
        )::int                               AS "aggDay",
        SUM(value) OVER (
          PARTITION BY metric_id, date_trunc('month', date_time)
        )::int                               AS "aggMonth",
        SUM(value) OVER (
          PARTITION BY metric_id, date_trunc('year', date_time)
        )::int                               AS "aggYear"
      FROM metric_readings
      WHERE metric_id = $1
      ORDER BY date_time
    `;
    return this.dataSource.query(sql, [params.metricId]);
  }
}
