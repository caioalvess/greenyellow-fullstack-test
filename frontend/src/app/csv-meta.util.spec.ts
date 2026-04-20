import { extractCsvMeta } from './csv-meta.util';

// Helper pra montar um File a partir de string. O construtor de File
// funciona no jsdom.
function csvFile(contents: string, name = 'data.csv'): File {
  return new File([contents], name, { type: 'text/csv' });
}

describe('csv-meta.util — extractCsvMeta', () => {
  it('extrai metricId + primeira e ultima data de um CSV pequeno', async () => {
    const csv = [
      '218219;10/11/2023 08:00;1',
      '218219;15/11/2023 12:00;1',
      '218219;21/11/2023 18:30;0',
    ].join('\n');

    const meta = await extractCsvMeta(csvFile(csv));

    expect(meta.metricId).toBe(218219);
    expect(meta.firstDate).toEqual(new Date(2023, 10, 10)); // mes 10 = novembro
    expect(meta.lastDate).toEqual(new Date(2023, 10, 21));
  });

  it('remove BOM UTF-8 antes de parsear', async () => {
    // BOM na frente corrompe o nome da primeira coluna se nao for tratado
    const csv = '\ufeff71590;05/10/2023 00:00;1\n71590;06/10/2023 00:00;1';

    const meta = await extractCsvMeta(csvFile(csv));

    expect(meta.metricId).toBe(71590);
    expect(meta.firstDate).toEqual(new Date(2023, 9, 5));
  });

  it('ignora linhas de padding ";;" no final (Excel exporta isso)', async () => {
    const csv = [
      '100;01/01/2024 00:00;1',
      '100;02/01/2024 00:00;1',
      ';;',
      ';;',
      '',
    ].join('\n');

    const meta = await extractCsvMeta(csvFile(csv));

    // a ultima data tem que ser 02/01/2024, nao null e nao as linhas vazias
    expect(meta.lastDate).toEqual(new Date(2024, 0, 2));
  });

  it('pula linha de header (metricId nao numerico)', async () => {
    const csv = [
      'metricId;dateTime;value',
      '42;03/03/2024 10:00;1',
    ].join('\n');

    const meta = await extractCsvMeta(csvFile(csv));

    expect(meta.metricId).toBe(42);
    expect(meta.firstDate).toEqual(new Date(2024, 2, 3));
  });

  it('lida com CRLF (Windows) no separador de linha', async () => {
    const csv = '100;01/01/2024 00:00;1\r\n100;05/01/2024 00:00;1\r\n';

    const meta = await extractCsvMeta(csvFile(csv));

    expect(meta.firstDate).toEqual(new Date(2024, 0, 1));
    expect(meta.lastDate).toEqual(new Date(2024, 0, 5));
  });

  it('retorna nulls quando nao ha linhas de dados validas', async () => {
    const csv = 'metricId;dateTime;value\n;;\n';

    const meta = await extractCsvMeta(csvFile(csv));

    expect(meta).toEqual({
      metricId: null,
      firstDate: null,
      lastDate: null,
      rowCount: null,
    });
  });

  it('rowCount exato quando o arquivo cabe no head chunk (<=64KB)', async () => {
    const csv = [
      'metricId;dateTime;value', // header — nao conta
      '100;01/01/2024 00:00;1',
      '100;02/01/2024 00:00;2',
      '100;03/01/2024 00:00;3',
      ';;',
      ';;',
    ].join('\n');

    const meta = await extractCsvMeta(csvFile(csv));

    expect(meta.rowCount).toBe(3);
  });

  it('rowCount estimado quando o arquivo excede o head chunk', async () => {
    const line = '100;15/06/2024 00:00;1\n';
    const repeats = 4000; // ~88KB, ultrapassa 64KB do head
    const csv = line.repeat(repeats);
    expect(csv.length).toBeGreaterThan(64 * 1024);

    const meta = await extractCsvMeta(csvFile(csv));

    // Linhas sao uniformes, entao a estimativa deve bater com alta precisao
    expect(meta.rowCount).not.toBeNull();
    expect(meta.rowCount!).toBeGreaterThan(repeats * 0.9);
    expect(meta.rowCount!).toBeLessThan(repeats * 1.1);
  });

  it('usa slice de head + tail quando arquivo excede o chunk (>64KB)', async () => {
    // Gera ~80KB com linhas conhecidas no inicio e no fim
    const firstLine = '100;01/01/2024 00:00;1\n';
    const lastLine = '100;31/12/2024 23:59;1\n';
    const filler = Array.from(
      { length: 3000 },
      (_, i) => `100;15/06/2024 ${String(i % 24).padStart(2, '0')}:00;1`,
    ).join('\n');
    const csv = firstLine + filler + '\n' + lastLine;

    expect(csv.length).toBeGreaterThan(64 * 1024);

    const meta = await extractCsvMeta(csvFile(csv));

    expect(meta.firstDate).toEqual(new Date(2024, 0, 1));
    expect(meta.lastDate).toEqual(new Date(2024, 11, 31));
  });
});
