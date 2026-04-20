import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * Registro de um CSV ja' aceito pelo sistema. O `sha256` e' computado
 * inline durante o upload (streaming, sem bufferizar) e serve como chave
 * de deduplicacao: dois arquivos com mesmo conteudo binario geram o
 * mesmo hash e o segundo e' rejeitado com 409 antes de publicar pra fila.
 *
 * Tambem e' onde o "reset" do usuario vai apagar referencias caso seja
 * adicionado um endpoint de limpeza — manter o historico aqui evita
 * depender de contar linhas no `metric_readings` pra saber quais arquivos
 * ja' foram processados.
 */
@Entity('csv_uploads')
@Unique('uq_csv_uploads_sha256', ['sha256'])
@Index('idx_csv_uploads_sha256', ['sha256'])
export class CsvUpload {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'sha256', type: 'varchar', length: 64 })
  sha256!: string;

  @Column({ name: 'blob_name', type: 'varchar', length: 512 })
  blobName!: string;

  @Column({ name: 'original_name', type: 'varchar', length: 512 })
  originalName!: string;

  @Column({ type: 'bigint' })
  size!: string;

  @CreateDateColumn({
    name: 'uploaded_at',
    type: 'timestamp with time zone',
  })
  uploadedAt!: Date;
}
