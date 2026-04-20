import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * `csv_upload_id` e' nullable pra acomodar o seed demo (metric 999),
 * que nasce via SQL script sem vinculo a um upload real. Rows com
 * NULL sao "permanentes" — nao sao afetadas pela limpeza ao trocar
 * de arquivo ativo.
 *
 * Unique composto inclui o upload_id: permite coexistencia temporaria
 * de rows de duas uploads (arquivo antigo fica vivo no banco ate o
 * proximo /aggregate, que entao limpa o stale). Sem o upload_id no
 * unique, ON CONFLICT DO NOTHING do consumer ignoraria as rows do
 * arquivo novo quando elas coincidem com (metric_id, date_time) do
 * antigo — a substituicao quebraria.
 */
@Entity('metric_readings')
@Unique('uq_metric_readings_metric_datetime_upload', [
  'metricId',
  'dateTime',
  'csvUploadId',
])
@Index('idx_metric_readings_metric_datetime', ['metricId', 'dateTime'])
@Index('idx_metric_readings_csv_upload', ['csvUploadId'])
export class MetricReading {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'metric_id', type: 'integer' })
  metricId!: number;

  @Column({ name: 'date_time', type: 'timestamp without time zone' })
  dateTime!: Date;

  @Column({ type: 'integer' })
  value!: number;

  @Column({ name: 'csv_upload_id', type: 'uuid', nullable: true })
  csvUploadId!: string | null;
}
