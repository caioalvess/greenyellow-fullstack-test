import { ApiProperty } from '@nestjs/swagger';

/**
 * Shape serializado devolvido pelo endpoint `GET /metrics/aggregate`.
 * Existe so' pra declarar o schema pro Swagger (@ApiOkResponse).
 */
export class AggregatedPointDto {
  @ApiProperty({ example: '2024-01-01', description: 'Data (YYYY-MM-DD) no início do bucket da granularidade' })
  date!: string;

  @ApiProperty({ example: 534, description: 'Soma dos values no bucket' })
  value!: number;
}
