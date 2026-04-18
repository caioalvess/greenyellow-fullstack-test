import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, Min } from 'class-validator';

export enum Granularity {
  DAY = 'DAY',
  MONTH = 'MONTH',
  YEAR = 'YEAR',
}

export class AggregateQueryDto {
  @ApiProperty({ example: 999, description: 'Identificador da métrica' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  metricId!: number;

  @ApiProperty({ example: '2024-01-01', description: 'Data inicial (YYYY-MM-DD), inclusiva' })
  @IsDateString({ strict: true }, { message: 'dateInitial deve estar em YYYY-MM-DD' })
  dateInitial!: string;

  @ApiProperty({ example: '2024-03-01', description: 'Data final (YYYY-MM-DD), inclusiva' })
  @IsDateString({ strict: true }, { message: 'finalDate deve estar em YYYY-MM-DD' })
  finalDate!: string;

  @ApiPropertyOptional({
    enum: Granularity,
    default: Granularity.DAY,
    description: 'Granularidade da agregação (default DAY)',
  })
  @IsOptional()
  @IsEnum(Granularity, { message: 'granularity deve ser DAY, MONTH ou YEAR' })
  granularity: Granularity = Granularity.DAY;
}
