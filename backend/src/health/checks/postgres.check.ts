import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import type { CheckResult } from '../health.controller';

@Injectable()
export class PostgresHealthCheck {
  private readonly logger = new Logger(PostgresHealthCheck.name);

  constructor(private readonly config: ConfigService) {}

  async check(): Promise<CheckResult> {
    // Mesmo perfil de SSL do DatabaseModule: azure PG exige TLS.
    const ssl =
      this.config.get<string>('POSTGRES_SSL', 'false') === 'true'
        ? { rejectUnauthorized: false }
        : undefined;
    const client = new Client({
      host: this.config.get<string>('POSTGRES_HOST', 'postgres'),
      port: this.config.get<number>('POSTGRES_PORT', 5432),
      user: this.config.get<string>('POSTGRES_USER'),
      password: this.config.get<string>('POSTGRES_PASSWORD'),
      database: this.config.get<string>('POSTGRES_DB'),
      ssl,
      connectionTimeoutMillis: 3000,
    });
    try {
      await client.connect();
      await client.query('SELECT 1');
      return { status: 'ok' };
    } catch (err) {
      const message = (err as Error).message;
      this.logger.warn(`Postgres check failed: ${message}`);
      return { status: 'down', detail: message };
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}
