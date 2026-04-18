import {
  Controller,
  Get,
  Header,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AggregateQueryDto } from './dto/aggregate-query.dto';
import { AggregatedPointDto } from './dto/aggregated-point.dto';
import { ReportQueryDto } from './dto/report-query.dto';
import { buildReportWorkbook } from './excel-report.util';
import { AggregatedPoint, MetricsRepository } from './metrics.repository';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@ApiTags('metrics')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly repo: MetricsRepository) {}

  @Get('aggregate')
  @ApiOperation({
    summary: 'Série agregada de uma métrica',
    description:
      'Retorna uma lista de pontos {date, value} somando os valores no nível ' +
      'de granularidade escolhido (dia, mês ou ano).',
  })
  @ApiOkResponse({ type: AggregatedPointDto, isArray: true })
  async aggregate(@Query() query: AggregateQueryDto): Promise<AggregatedPoint[]> {
    return this.repo.aggregate({
      metricId: query.metricId,
      dateInitial: query.dateInitial,
      finalDate: query.finalDate,
      granularity: query.granularity,
    });
  }

  @Get('report')
  @ApiOperation({
    summary: 'Relatório Excel com agregações por dia/mês/ano',
    description:
      'Devolve um arquivo .xlsx com uma linha por leitura original da métrica, ' +
      'contendo colunas MetricId, DateTime, AggDay, AggMonth, AggYear (somas ' +
      'calculadas com window functions).',
  })
  @ApiProduces(XLSX_MIME)
  @Header('Content-Type', XLSX_MIME)
  async report(
    @Query() query: ReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const rows = await this.repo.report(query);
    const buffer = await buildReportWorkbook(rows);
    const filename = `report-${query.metricId}-${query.dateInitial}_to_${query.finalDate}.xlsx`;
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    return new StreamableFile(buffer);
  }
}
