import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { AzuriteService } from '../azurite/azurite.service';
import { RabbitMqService } from '../rabbitmq/rabbitmq.service';
import { CsvUpload } from './entities/csv-upload.entity';
import { UploadStatusStore } from './upload-status.store';

export type UploadedMessage = {
  blobName: string;
  originalName: string;
  uploadedAt: string;
  size: number;
};

const PG_UNIQUE_VIOLATION = '23505';

function shortHash(sha: string): string {
  return sha.slice(0, 12);
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(2)}MB`;
}

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    private readonly rabbitmq: RabbitMqService,
    private readonly statusStore: UploadStatusStore,
    private readonly azurite: AzuriteService,
    @InjectRepository(CsvUpload)
    private readonly uploadsRepo: Repository<CsvUpload>,
  ) {}

  /**
   * Fluxo do POST /uploads, passo a passo:
   *
   *  1. O multer + AzuriteStorageEngine ja' streamou o arquivo pro blob
   *     e populou `file.sha256` via Sha256PassThrough.
   *  2. Checamos se o hash ja' existe no `csv_uploads`. Se sim → 409,
   *     deleta o blob recem-uploaded (rollback) e encerra.
   *  3. Se nao: buscamos o upload ATIVO ATUAL. Se existir, apagamos o
   *     blob dele do Azurite — o storage mantem no maximo 1 arquivo
   *     por vez (requisito do sistema). A linha do csv_uploads antigo
   *     fica viva ate o proximo /metrics/aggregate ou /metrics/report,
   *     que entao limpa o stale junto com suas leituras (substituicao
   *     tardia, "no ato da consulta").
   *  4. Gravamos a nova linha em csv_uploads (idempotencia via unique
   *     sha256 cobre corrida entre requests identicos).
   *  5. Publicamos mensagem pra RabbitMQ pro consumer processar.
   */
  async handleUpload(file: Express.Multer.File): Promise<UploadedMessage> {
    const blobName = file.filename;
    const sha256 = file.sha256;
    const sizeHuman = humanBytes(file.size);

    this.logger.log(
      `📥 upload recebido → ${file.originalname} (${sizeHuman})`,
    );

    if (!sha256) {
      await this.azurite.deleteBlob(blobName);
      throw new InternalServerErrorException(
        'hash do arquivo nao foi calculado pelo storage engine',
      );
    }

    this.logger.log(`🧮 hash computado → sha256=${shortHash(sha256)}…`);
    this.logger.log(`☁️  armazenado no Azurite → blob=${blobName}`);

    // 2) Dedup pre-check
    const duplicate = await this.uploadsRepo.findOne({ where: { sha256 } });
    if (duplicate) {
      await this.azurite.deleteBlob(blobName);
      this.logger.warn(
        `🚫 dedup → blob descartado; hash ja existente em "${duplicate.originalName}" (${duplicate.uploadedAt.toISOString()})`,
      );
      throw new ConflictException({
        message: 'arquivo duplicado: conteudo identico ja foi enviado',
        existing: {
          originalName: duplicate.originalName,
          uploadedAt: duplicate.uploadedAt.toISOString(),
          size: Number(duplicate.size),
        },
      });
    }
    this.logger.log(`✅ dedup → hash inedito, segue o fluxo`);

    // 3) Substituicao no storage: o Azurite fica com no maximo 1 blob.
    const previous = await this.uploadsRepo.findOne({
      where: {},
      order: { uploadedAt: 'DESC' },
    });
    if (previous) {
      await this.azurite.deleteBlob(previous.blobName);
      this.logger.log(
        `🔁 substituicao → blob anterior removido do Azurite (${previous.originalName} → ${previous.blobName})`,
      );
    }

    // 4) Grava o registro. Race resolvida pelo unique sha256 (23505 → 409).
    let saved: CsvUpload;
    try {
      saved = await this.uploadsRepo.save(
        this.uploadsRepo.create({
          sha256,
          blobName,
          originalName: file.originalname,
          size: String(file.size),
        }),
      );
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err.driverError as { code?: string } | undefined)?.code ===
          PG_UNIQUE_VIOLATION
      ) {
        await this.azurite.deleteBlob(blobName);
        const winner = await this.uploadsRepo.findOne({ where: { sha256 } });
        throw new ConflictException({
          message: 'arquivo duplicado: conteudo identico ja foi enviado',
          existing: winner
            ? {
                originalName: winner.originalName,
                uploadedAt: winner.uploadedAt.toISOString(),
                size: Number(winner.size),
              }
            : undefined,
        });
      }
      throw err;
    }
    this.logger.log(`💾 csv_uploads → registro salvo id=${saved.id}`);

    // Cleanup eager dos registros antigos: mantem apenas o recem-gravado
    // em `csv_uploads`. Decisao por 2 motivos:
    //   1. Dedup por hash: um arquivo previamente enviado mas nao mais
    //      ativo nao deve bloquear reenvio (UX: "eu troquei pro B, agora
    //      quero voltar pro A" — o hash de A nao pode 409-ar).
    //   2. Coerencia com a substituicao eager do blob no Azurite — o
    //      storage ja reflete "1 arquivo por vez", a metadata segue a
    //      mesma politica.
    // `metric_readings` continua sendo lazy-limpo no /aggregate pra
    // preservar a UX "dado substituido no ato da consulta" — as rows
    // stale viram orfas (csv_upload_id aponta pra UUID que nao existe
    // mais) e sao deletadas no proximo query.
    const dropped = (await this.uploadsRepo.query(
      `DELETE FROM csv_uploads WHERE id <> $1::uuid`,
      [saved.id],
    )) as [unknown, number];
    const droppedCount = Array.isArray(dropped) ? dropped[1] : 0;
    if (droppedCount > 0) {
      this.logger.log(
        `🧹 csv_uploads → ${droppedCount} registro(s) antigo(s) removido(s) (historico limpo, so o ativo persiste)`,
      );
    }

    this.statusStore.register(blobName);

    // 5) Enfileira pro consumer.
    const message: UploadedMessage = {
      blobName,
      originalName: file.originalname,
      uploadedAt: new Date().toISOString(),
      size: file.size,
    };
    const queue = this.rabbitmq.uploadQueue;
    this.rabbitmq.publish(queue, message);
    this.logger.log(
      `📤 rabbitmq → mensagem publicada na fila "${queue}" (blob=${blobName})`,
    );

    return message;
  }
}
