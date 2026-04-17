import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';

type AmqpConnection = Awaited<ReturnType<typeof amqp.connect>>;
type AmqpChannel = Awaited<ReturnType<AmqpConnection['createChannel']>>;

@Injectable()
export class RabbitMqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqService.name);
  private connection?: AmqpConnection;
  private channel?: AmqpChannel;

  /** Nome da fila principal do pipeline — parametrizavel por env pra isolar testes E2E */
  readonly uploadQueue: string;

  constructor(private readonly config: ConfigService) {
    this.uploadQueue = this.config.get<string>(
      'UPLOAD_QUEUE_NAME',
      'csv.uploaded',
    );
  }

  async onModuleInit() {
    const url = this.buildUrl();
    this.connection = await amqp.connect(url);
    this.channel = await this.connection.createChannel();
    await this.channel.assertQueue(this.uploadQueue, { durable: true });
    this.logger.log(
      `Connected to RabbitMQ, queue '${this.uploadQueue}' asserted`,
    );
  }

  async onModuleDestroy() {
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }

  publish(queue: string, message: unknown): boolean {
    if (!this.channel) {
      throw new Error('RabbitMQ channel is not initialized');
    }
    const payload = Buffer.from(JSON.stringify(message));
    return this.channel.sendToQueue(queue, payload, {
      persistent: true,
      contentType: 'application/json',
    });
  }

  async consume(
    queue: string,
    handler: (payload: unknown, raw: amqp.Message) => Promise<void>,
  ): Promise<void> {
    if (!this.channel) {
      throw new Error('RabbitMQ channel is not initialized');
    }
    const channel = this.channel;
    await channel.assertQueue(queue, { durable: true });
    await channel.consume(queue, async (msg) => {
      if (!msg) return;
      try {
        const payload = JSON.parse(msg.content.toString()) as unknown;
        await handler(payload, msg);
        channel.ack(msg);
      } catch (err) {
        const message = (err as Error).message;
        this.logger.error(`Consumer for ${queue} failed: ${message}`);
        // requeue=false: nao reentra na fila. Sem DLQ por ora — anotado pra Fase 7.
        channel.nack(msg, false, false);
      }
    });
    this.logger.log(`Consumer started on queue '${queue}'`);
  }

  private buildUrl(): string {
    // Se RABBITMQ_URL (amqp/amqps completa) estiver setada, prioriza.
    // Util pra servicos gerenciados como CloudAMQP que fornecem uma URL
    // pronta com TLS + vhost (ex.: amqps://user:pass@host/vhost).
    const fullUrl = this.config.get<string>('RABBITMQ_URL');
    if (fullUrl) return fullUrl;

    const user = this.config.get<string>('RABBITMQ_USER');
    const pass = this.config.get<string>('RABBITMQ_PASSWORD');
    const host = this.config.get<string>('RABBITMQ_HOST', 'rabbitmq');
    const port = this.config.get<number>('RABBITMQ_PORT', 5672);
    return `amqp://${user}:${pass}@${host}:${port}`;
  }
}
