/**
 * Le os primeiros e ultimos bytes do CSV pra extrair metadata minima
 * e preencher o form sem esperar o consumer processar o blob.
 *
 * Layout esperado: "metricId;dateTime;value" com dateTime = DD/MM/YYYY HH:MM.
 * Linhas "" ou ";;" sao padding e sao ignoradas.
 */

export interface CsvMeta {
  metricId: number | null;
  firstDate: Date | null;
  lastDate: Date | null;
  /**
   * Quantidade aproximada de linhas de DADOS (exclui header e padding
   * `;;`). Se o arquivo cabe no chunk de 64KB, e' exato; se excede,
   * e' estimado pelo ratio (linhas validas no head / bytes do head) ×
   * tamanho total. A aproximacao e' precisa o bastante pra preview —
   * valor final sai do backend quando o consumer termina de processar.
   */
  rowCount: number | null;
}

const CHUNK_BYTES = 64 * 1024;

export async function extractCsvMeta(file: File): Promise<CsvMeta> {
  const headBytes = Math.min(CHUNK_BYTES, file.size);
  const headText = await readTextSlice(file, 0, headBytes);
  const headLines = splitValidLines(headText);
  const first = findFirstDataLine(headLines);

  let last: ReturnType<typeof parseDataLine> = null;

  if (file.size > CHUNK_BYTES) {
    const tailText = await readTextSlice(
      file,
      Math.max(0, file.size - CHUNK_BYTES),
      file.size,
    );
    // a primeira "linha" do tail pode estar cortada — descarta
    const tailLines = splitValidLines(tailText).slice(1);
    last = findLastDataLine(tailLines);
  } else {
    // arquivo cabe num chunk — olha a cauda do proprio head
    last = findLastDataLine(headLines);
  }

  return {
    metricId: first?.metricId ?? null,
    firstDate: first?.date ?? null,
    lastDate: last?.date ?? first?.date ?? null,
    rowCount: estimateRowCount(headLines, headBytes, file.size),
  };
}

/**
 * Conta linhas de dados validas (que parseam como leitura) no head e
 * extrapola pro arquivo inteiro. Se o head ja cobre o arquivo todo,
 * devolve o valor exato.
 */
function estimateRowCount(
  headLines: string[],
  headBytes: number,
  totalBytes: number,
): number | null {
  if (headLines.length === 0 || headBytes === 0) return null;
  const dataLinesInHead = headLines.filter(
    (l) => parseDataLine(l) !== null,
  ).length;
  if (dataLinesInHead === 0) return null;
  if (totalBytes <= headBytes) return dataLinesInHead;
  return Math.round((totalBytes / headBytes) * dataLinesInHead);
}

function splitValidLines(text: string): string[] {
  // remove BOM e separa
  const cleaned = text.replace(/^\ufeff/, '');
  return cleaned
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^;+$/.test(l));
}

function findFirstDataLine(
  lines: string[],
): ReturnType<typeof parseDataLine> {
  for (const line of lines) {
    const parsed = parseDataLine(line);
    if (parsed) return parsed;
  }
  return null;
}

function findLastDataLine(
  lines: string[],
): ReturnType<typeof parseDataLine> {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const parsed = parseDataLine(lines[i]);
    if (parsed) return parsed;
  }
  return null;
}

function parseDataLine(
  line: string | undefined,
): { metricId: number; date: Date } | null {
  if (!line) return null;
  const parts = line.split(';');
  if (parts.length < 3) return null;
  const [idRaw, dtRaw] = parts;
  const metricId = Number(idRaw);
  if (!Number.isFinite(metricId)) return null; // provavel linha de header
  const match = dtRaw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return null;
  const [, day, month, year] = match;
  return {
    metricId,
    date: new Date(Number(year), Number(month) - 1, Number(day)),
  };
}

function readTextSlice(file: File, start: number, end: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file.slice(start, end));
  });
}
