import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import type { Readable } from 'node:stream';

// Tamanho do chunk interno que o SDK usa ao enviar blocos pro Azurite.
// 4MB e' o ponto de equilibrio: batches grandes o bastante pra amortizar
// latencia de rede, pequenos o bastante pra nao estourar memoria.
const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
const UPLOAD_MAX_CONCURRENCY = 5;

@Injectable()
export class AzuriteService implements OnModuleInit {
  private readonly logger = new Logger(AzuriteService.name);
  private blobService!: BlobServiceClient;
  private container!: ContainerClient;
  private readonly containerName: string;

  constructor(private readonly config: ConfigService) {
    this.containerName = this.config.get<string>('BLOB_CONTAINER', 'csv-uploads');
  }

  async onModuleInit() {
    const connectionString = this.config.getOrThrow<string>('AZURITE_CONNECTION_STRING');
    this.blobService = BlobServiceClient.fromConnectionString(connectionString);
    this.container = this.blobService.getContainerClient(this.containerName);
    const result = await this.container.createIfNotExists();
    if (result.succeeded) {
      this.logger.log(`Blob container '${this.containerName}' created`);
    } else {
      this.logger.log(`Blob container '${this.containerName}' already exists`);
    }
  }

  /**
   * Streaming upload: le do Readable em chunks e envia em blocos ao Azurite.
   * Nao bufera o arquivo inteiro — memoria fica em O(chunk * concurrency).
   */
  async uploadFromStream(
    blobName: string,
    stream: Readable,
    contentType?: string,
  ): Promise<{ blobName: string; size: number }> {
    const blobClient = this.container.getBlockBlobClient(blobName);
    await blobClient.uploadStream(
      stream,
      UPLOAD_CHUNK_BYTES,
      UPLOAD_MAX_CONCURRENCY,
      {
        blobHTTPHeaders: contentType
          ? { blobContentType: contentType }
          : undefined,
      },
    );
    const props = await blobClient.getProperties();
    return { blobName, size: props.contentLength ?? 0 };
  }

  /**
   * Streaming download: retorna o Readable direto do Azurite.
   * Quem consome (ex.: csv-parse) le em chunks — nunca materializa o blob inteiro.
   */
  async downloadBlobStream(blobName: string): Promise<NodeJS.ReadableStream> {
    const blobClient = this.container.getBlockBlobClient(blobName);
    const response = await blobClient.download();
    if (!response.readableStreamBody) {
      throw new Error(`blob '${blobName}' nao retornou stream`);
    }
    return response.readableStreamBody;
  }

  async listBlobs(): Promise<string[]> {
    const names: string[] = [];
    for await (const blob of this.container.listBlobsFlat()) {
      names.push(blob.name);
    }
    return names;
  }

  /**
   * Remove um blob. Usado no rollback de dedup: quando um upload
   * duplicado termina de streamar pro Azurite e o UploadsService
   * detecta o hash ja' conhecido, deletamos o blob pra nao acumular
   * lixo. Se o blob nao existir, `deleteIfExists` retorna sem erro.
   */
  async deleteBlob(blobName: string): Promise<void> {
    const blobClient = this.container.getBlockBlobClient(blobName);
    await blobClient.deleteIfExists();
  }
}
