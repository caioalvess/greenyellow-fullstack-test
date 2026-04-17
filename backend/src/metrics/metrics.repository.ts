import { Injectable } from '@nestjs/common';
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

@Injectable()
export class MetricsRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Insere UM lote de leituras atomicamente.
   * ON CONFLICT DO NOTHING torna a operacao idempotente — se o consumer
   * reprocessa um blob (ex.: nack+requeue, reupload), duplicatas sao ignoradas.
   * Retorna quantas linhas foram efetivamente inseridas.
   */
  async insertBatch(rows: ParsedRow[]): Promise<number> {
    if (rows.length === 0) return 0;

    const placeholders: string[] = [];
    const params: unknown[] = [];
    rows.forEach((row, idx) => {
      const offset = idx * 3;
      placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3})`);
      params.push(row.metricId, row.dateTime, row.value);
    });

    const sql = `
      INSERT INTO metric_readings (metric_id, date_time, value)
      VALUES ${placeholders.join(',')}
      ON CONFLICT (metric_id, date_time) DO NOTHING
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

  async aggregate(params: {
    metricId: number;
    dateInitial: string;
    finalDate: string;
    granularity: Granularity;
  }): Promise<AggregatedPoint[]> {
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
