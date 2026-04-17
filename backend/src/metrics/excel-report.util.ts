import { Workbook } from 'exceljs';
import type { ReportRow } from './metrics.repository';

export async function buildReportWorkbook(rows: ReportRow[]): Promise<Buffer> {
  const wb = new Workbook();
  const sheet = wb.addWorksheet('Report');

  sheet.columns = [
    { header: 'MetricId', key: 'metricId', width: 12 },
    { header: 'DateTime', key: 'dateTime', width: 14 },
    { header: 'Aggday',   key: 'aggDay',   width: 10 }, // "d" minusculo — enunciado
    { header: 'AggMonth', key: 'aggMonth', width: 12 },
    { header: 'AggYear',  key: 'aggYear',  width: 12 },
  ];

  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    sheet.addRow(row);
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
