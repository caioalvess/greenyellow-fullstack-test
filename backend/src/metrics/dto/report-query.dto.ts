import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, Min } from 'class-validator';

export class ReportQueryDto {
  @ApiProperty({ example: 999, description: 'Identificador da métrica' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  metricId!: number;

  @ApiProperty({ example: '2024-01-01', description: 'Data inicial do relatório (YYYY-MM-DD)' })
  @IsDateString({ strict: true }, { message: 'dateInitial deve estar em YYYY-MM-DD' })
  dateInitial!: string;

  @ApiProperty({ example: '2024-03-01', description: 'Data final do relatório (YYYY-MM-DD)' })
  @IsDateString({ strict: true }, { message: 'finalDate deve estar em YYYY-MM-DD' })
  finalDate!: string;
}
