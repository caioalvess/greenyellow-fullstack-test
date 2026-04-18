import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { PostgresHealthCheck } from './checks/postgres.check';
import { RabbitMqHealthCheck } from './checks/rabbitmq.check';
import { AzuriteHealthCheck } from './checks/azurite.check';

export type CheckResult = { status: 'ok' | 'down'; detail?: string };

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly postgres: PostgresHealthCheck,
    private readonly rabbit: RabbitMqHealthCheck,
    private readonly azurite: AzuriteHealthCheck,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Health check agregado',
    description: 'Checa Postgres, RabbitMQ e Azurite em paralelo. Retorna 200 se todos ok, 503 caso contrário.',
  })
  async check(@Res({ passthrough: true }) res: Response) {
    const [postgres, rabbitmq, azurite] = await Promise.all([
      this.postgres.check(),
      this.rabbit.check(),
      this.azurite.check(),
    ]);
    const allOk = [postgres, rabbitmq, azurite].every((r) => r.status === 'ok');
    res.status(allOk ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: allOk ? 'ok' : 'down',
      services: { postgres, rabbitmq, azurite },
    };
  }
}
