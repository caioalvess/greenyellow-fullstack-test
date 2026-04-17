import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import type { CheckResult } from '../health.controller';

@Injectable()
export class RabbitMqHealthCheck {
  private readonly logger = new Logger(RabbitMqHealthCheck.name);

  constructor(private readonly config: ConfigService) {}

  async check(): Promise<CheckResult> {
    // RABBITMQ_URL (ex.: CloudAMQP) tem prioridade sobre os campos individuais.
    const fullUrl = this.config.get<string>('RABBITMQ_URL');
    const url =
      fullUrl ??
      (() => {
        const host = this.config.get<string>('RABBITMQ_HOST', 'rabbitmq');
        const port = this.config.get<number>('RABBITMQ_PORT', 5672);
        const user = this.config.get<string>('RABBITMQ_USER');
        const pass = this.config.get<string>('RABBITMQ_PASSWORD');
        return `amqp://${user}:${pass}@${host}:${port}`;
      })();

    let conn: Awaited<ReturnType<typeof amqp.connect>> | undefined;
    try {
      conn = await amqp.connect(url);
      return { status: 'ok' };
    } catch (err) {
      const message = (err as Error).message;
      this.logger.warn(`RabbitMQ check failed: ${message}`);
      return { status: 'down', detail: message };
    } finally {
      await conn?.close().catch(() => undefined);
    }
  }
}
