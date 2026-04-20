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
   * O Multer + AzuriteStorageEngine ja' fez o streaming do arquivo pro blob
   * e deixou o SHA-256 em `file.sha256`. Antes de enfileirar pro consumer,
   * checamos se o hash ja' existe:
   *   - existe → deletamos o blob recem-uploaded (rollback) e retornamos 409
   *   - nao existe → gravamos no `csv_uploads` e publicamos pra fila
   *
   * Tratamos race condition (dois uploads simultaneos do mesmo conteudo)
   * via try/catch do unique constraint na escrita. Isso mantem Azurite +
   * Postgres consistentes: um arquivo so' fica persistido se o registro
   * gravou com sucesso.
   */
  async handleUpload(file: Express.Multer.File): Promise<UploadedMessage> {
    const blobName = file.filename;
    const sha256 = file.sha256;

    if (!sha256) {
      await this.azurite.deleteBlob(blobName);
      throw new InternalServerErrorException(
        'hash do arquivo nao foi calculado pelo storage engine',
      );
    }

    this.logger.log(
      `Uploaded ${blobName} (${file.size} bytes, sha256=${sha256.slice(0, 12)}…)`,
    );

    // Pre-check: rejeita rapido se o hash ja' e' conhecido.
    const existing = await this.uploadsRepo.findOne({ where: { sha256 } });
    if (existing) {
      await this.azurite.deleteBlob(blobName);
      this.logger.warn(
        `Dedup: blob ${blobName} rejeitado — hash ja existe (${existing.originalName} @ ${existing.uploadedAt.toISOString()})`,
      );
      throw new ConflictException({
        message: 'arquivo duplicado: conteudo identico ja foi enviado',
        existing: {
          originalName: existing.originalName,
          uploadedAt: existing.uploadedAt.toISOString(),
          size: Number(existing.size),
        },
      });
    }

    // Grava o registro. Se duas requisicoes com mesmo conteudo chegarem
    // juntas e ambas passarem o pre-check, o unique constraint resolve:
    // a primeira grava, a segunda leva 23505 e e' convertida em 409.
    try {
      await this.uploadsRepo.save(
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

    this.statusStore.register(blobName);

    const message: UploadedMessage = {
      blobName,
      originalName: file.originalname,
      uploadedAt: new Date().toISOString(),
      size: file.size,
    };
    const queue = this.rabbitmq.uploadQueue;
    this.rabbitmq.publish(queue, message);
    this.logger.log(`Published ${blobName} to queue ${queue}`);

    return message;
  }
}
