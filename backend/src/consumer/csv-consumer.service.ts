import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AzuriteService } from '../azurite/azurite.service';
import { RabbitMqService } from '../rabbitmq/rabbitmq.service';
import { MetricsRepository } from '../metrics/metrics.repository';
import { parseRowsInBatches } from '../metrics/csv-parser.util';
import { CsvUpload } from '../uploads/entities/csv-upload.entity';
import { UploadStatusStore } from '../uploads/upload-status.store';

type UploadedMessage = {
  blobName: string;
  originalName: string;
  uploadedAt: string;
  size: number;
};

const BATCH_SIZE = 1000;

@Injectable()
export class CsvConsumerService implements OnModuleInit {
  private readonly logger = new Logger(CsvConsumerService.name);

  constructor(
    private readonly rabbitmq: RabbitMqService,
    private readonly azurite: AzuriteService,
    private readonly metrics: MetricsRepository,
    private readonly statusStore: UploadStatusStore,
    @InjectRepository(CsvUpload)
    private readonly uploadsRepo: Repository<CsvUpload>,
  ) {}

  async onModuleInit() {
    await this.rabbitmq.consume(this.rabbitmq.uploadQueue, async (payload) => {
      await this.process(payload as UploadedMessage);
    });
  }

  private async process(msg: UploadedMessage): Promise<void> {
    const startedAt = Date.now();
    this.logger.log(
      `📥 rabbitmq → mensagem consumida (blob=${msg.blobName}, origem=${msg.originalName})`,
    );
    this.statusStore.start(msg.blobName);

    try {
      // Upload e' criado PELO UploadsService ANTES da publicacao. Quando
      // o consumer acorda aqui, o registro ja existe — resolvemos o id
      // pelo blobName pra amarrar cada linha inserida ao upload de origem.
      //
      // Caso raro: a mensagem refere um upload que nao existe mais —
      // acontece por (a) mensagens remanescentes de runs anteriores da
      // fila de teste, ou (b) upload substituido antes do consumer pegar
      // a mensagem original. Nesses casos apenas ACKamos e saimos — a
      // fila nao fica travada e o proximo upload valido e' processado.
      const upload = await this.uploadsRepo.findOne({
        where: { blobName: msg.blobName },
      });
      if (!upload) {
        this.logger.warn(
          `⚠️ csv_uploads sem registro para blob=${msg.blobName} — mensagem descartada`,
        );
        this.statusStore.complete(msg.blobName);
        return;
      }
      this.logger.log(
        `🔗 vinculado ao upload → id=${upload.id} sha256=${upload.sha256.slice(0, 12)}…`,
      );

      this.logger.log(`⬇️  baixando stream do Azurite → blob=${msg.blobName}`);
      let stream: NodeJS.ReadableStream;
      try {
        stream = await this.azurite.downloadBlobStream(msg.blobName);
      } catch (err) {
        const e = err as { statusCode?: number; message?: string };
        if (e.statusCode === 404 || /BlobNotFound/i.test(e.message ?? '')) {
          this.logger.warn(
            `⚠️ blob ${msg.blobName} nao existe mais (substituido por upload mais recente) — pulando`,
          );
          this.statusStore.complete(msg.blobName);
          return;
        }
        throw err;
      }

      this.logger.log(
        `📊 parse → iniciando em lotes de ${BATCH_SIZE} linhas`,
      );

      let totalRead = 0;
      let totalInserted = 0;
      let batchNumber = 0;

      for await (const batch of parseRowsInBatches(stream, BATCH_SIZE)) {
        batchNumber += 1;
        totalRead += batch.length;
        const inserted = await this.metrics.insertBatch(batch, upload.id);
        totalInserted += inserted;
        this.statusStore.incrementRows(msg.blobName, batch.length);
        // Log "por lote" so' no primeiro, no decimo, e depois a cada 25
        // — evita poluir a saida em CSVs grandes (ex.: 94 batches).
        if (batchNumber === 1 || batchNumber === 10 || batchNumber % 25 === 0) {
          this.logger.log(
            `📊 lote #${batchNumber} → +${inserted}/${batch.length} (acum=${totalInserted}/${totalRead})`,
          );
        }
      }

      this.statusStore.complete(msg.blobName);
      const elapsed = Date.now() - startedAt;
      this.logger.log(
        `✅ processamento concluido → ${totalInserted}/${totalRead} linhas em ${batchNumber} lote(s) · ${elapsed}ms · blob=${msg.blobName}`,
      );
    } catch (err) {
      const message = (err as Error).message;
      this.statusStore.fail(msg.blobName, message);
      this.logger.error(`❌ processamento falhou → ${message}`);
      throw err; // re-lanca pro wrapper do RabbitMqService fazer nack
    }
  }
}
