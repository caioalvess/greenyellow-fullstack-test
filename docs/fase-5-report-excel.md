# Fase 5 — Relatório Excel

**Objetivo:** endpoint que gera um arquivo Excel com colunas `MetricId | DateTime | AggDay | AggMonth | AggYear` pro período requisitado. Atende item 8 do enunciado.

---

## 1. Contrato

### Request

```
GET /metrics/report?metricId=218219&dateInitial=2023-11-01&finalDate=2023-11-30
```

Mesmos params do `/metrics/aggregate` **sem** `granularity` (o relatório traz as três agregações em colunas).

### Response

```
HTTP/1.1 200 OK
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="report-218219-2023-11-01_to_2023-11-30.xlsx"
Content-Length: 6618
```

Arquivo `.xlsx` com uma planilha "Report":

| MetricId | DateTime   | AggDay | AggMonth | AggYear |
|----------|------------|--------|----------|---------|
| 218219   | 21/11/2023 | 266    | 362      | 362     |
| 218219   | 22/11/2023 | 96     | 362      | 362     |

Uma linha por **dia com leitura** no range requisitado.

---

## 2. Arquivos criados / alterados

```
backend/src/
├── metrics/
│   ├── dto/report-query.dto.ts       # igual ao aggregate sem granularity
│   ├── excel-report.util.ts          # builder do workbook com exceljs
│   ├── metrics.controller.ts         # + rota GET /metrics/report
│   └── metrics.repository.ts         # + metodo report() + tipo ReportRow
backend/package.json                  # + exceljs
```

## 3. Decisões

### Semântica das agregações: **calendário completo** (AggMonth = mês inteiro, AggYear = ano inteiro)
Olhando a tabela de exemplo do enunciado item 8:

```
MetricId | DateTime   | AggDay | AggMonth | AggYear
71590    | 01/11/2023 |   1    |    4     |   32
...
71590    | 01/01/2024 |   1    |    4     |   16    ← dia de 2024
```

Pistas no exemplo:
- O input é `dateInitial: 2023-11-01, finalDate: 2023-12-31`, mas a saída inclui dias de **01/01/2024** → as linhas exibidas **não são** estritamente limitadas ao range (ou o range do exemplo difere do texto).
- `AggMonth` de novembro e dezembro de 2023 = **4** em todas as linhas. Se apenas 4 dias de cada mês estão no banco (como o próprio exemplo sugere), isso bate com "mês calendário completo" (4 dias × valor 1).
- `AggYear` de 2023 = **32**. Se fosse só a soma dos dias mostrados (Nov 4 + Dez 4 = 8), não bateria. 32 só faz sentido se o ano tem **outros dias no banco** além dos mostrados.

Conclusão: o filtro `[dateInitial, finalDate]` restringe **quais linhas aparecem** no Excel, mas `aggMonth` e `aggYear` refletem o **mês/ano calendário inteiro** da métrica no banco.

> ⚠️ **Correção pós-review:** a primeira versão dessa implementação interpretou "range-bound" (aggMonth/aggYear sumavam apenas dias dentro do filtro). O ponto foi sinalizado durante a revisão do código e o comportamento foi corrigido pra refletir a semântica do enunciado.

### SQL: CTE sobre histórico completo + window → filtro final

```sql
WITH
  full_history AS (
    SELECT
      metric_id,
      date_trunc('day', date_time)::date AS day,
      date_trunc('month', date_time)     AS month_trunc,
      date_trunc('year', date_time)      AS year_trunc,
      SUM(value)                         AS day_sum
    FROM metric_readings
    WHERE metric_id = $1           -- so' filtra a METRICA, nao a data
    GROUP BY 1, 2, 3, 4
  ),
  with_aggs AS (
    SELECT
      metric_id,
      day,
      day_sum,
      SUM(day_sum) OVER (PARTITION BY metric_id, month_trunc) AS agg_month,
      SUM(day_sum) OVER (PARTITION BY metric_id, year_trunc)  AS agg_year
    FROM full_history
  )
SELECT
  metric_id                  AS "metricId",
  to_char(day, 'DD/MM/YYYY') AS "dateTime",
  day_sum::int               AS "aggDay",
  agg_month::int             AS "aggMonth",
  agg_year::int              AS "aggYear"
FROM with_aggs
WHERE day >= $2::date AND day <= $3::date    -- filtro de data SO AQUI, no fim
ORDER BY day
```

**Ordem do processamento é crítica:**
1. `full_history` agrupa por dia **sem filtrar data** — retorna toda a série histórica daquela metric.
2. `with_aggs` aplica window functions sobre esse histórico completo → cada linha ganha seu `agg_month` (soma do mês calendário inteiro) e `agg_year` (soma do ano calendário inteiro).
3. O `WHERE` final **descarta** as linhas fora do range requisitado, mas **as agregações já foram calculadas** sobre o set completo.

Por que CTE + window (e não 3 queries):
- **1 round-trip** só.
- Índice `(metric_id, date_time)` é usado no WHERE do `full_history`.
- `PARTITION BY metric_id, month_trunc` e `metric_id, year_trunc` calculam independentes.

### Formato da data como `DD/MM/YYYY` (texto)
O enunciado mostra `01/11/2023` no exemplo. Usar `to_char(day, 'DD/MM/YYYY')` devolve string direta. Evita:
- `Date` do JS virando ISO com timezone (feio no Excel e no JSON).
- Configurar `numFmt` de cada célula do exceljs (possível mas mais trabalho e frágil).

### `exceljs` em lugar de `xlsx` (SheetJS)
- `exceljs` tem API fluente e tipagem boa.
- `xlsx` (SheetJS) é menor mas a API é mais verbose e a versão community tem pouco suporte.
- Volume esperado é pequeno (<10k linhas) — nenhuma das duas tem gargalo.

### Resposta via `StreamableFile` + `@Header()`
O padrão novo do NestJS pra retorno de arquivo:
```typescript
@Get('report')
@Header('Content-Type', XLSX_MIME)
async report(@Query() query, @Res({ passthrough: true }) res): Promise<StreamableFile> {
  const buffer = await buildReportWorkbook(rows);
  res.set('Content-Disposition', `attachment; filename="..."`);
  return new StreamableFile(buffer);
}
```

- `@Header()` seta o Content-Type estático.
- `@Res({ passthrough: true })` permite setar header dinâmico (Content-Disposition com filename variável) **sem** perder o ciclo de vida do Nest (interceptors, filters, etc).
- `StreamableFile(buffer)` serializa a resposta binária corretamente.

### Colunas com `key` e `width` no sheet
```typescript
sheet.columns = [
  { header: 'MetricId', key: 'metricId', width: 12 },
  ...
];
sheet.addRow({ metricId: 218219, dateTime: '21/11/2023', ... });
```
Com `key`, o `addRow(obj)` mapeia por nome ao invés de posição. Menos bug-prone que passar array.

---

## 4. Verificação executada (2026-04-16)

| # | Teste | Resultado |
|---|-------|-----------|
| 1 | Headers HTTP: Content-Type xlsx, Content-Disposition com filename | ✅ |
| 2 | `file(1)` identifica como "Microsoft Excel 2007+" | ✅ |
| 3 | Header do sheet exatamente `MetricId \| DateTime \| AggDay \| AggMonth \| AggYear` | ✅ |
| 4 | Linhas do CSV real: 2 dias (21/11 e 22/11) com AggDay=266/96, AggMonth=362, AggYear=362 | ✅ |
| 5 | Consistência: 266+96=362 bate com AggMonth e AggYear | ✅ |
| 6 | Validação `metricId=abc` → 400 | ✅ |
| 7 | Range fora dos dados → xlsx válido com só o header | ✅ |
| 8 | Multi-mês (fixture com out=5+3, nov=7+2): AggMonth out=8, AggMonth nov=9, AggYear=17 | ✅ |
| 9 | **Full calendar**: com dia 15/10 fora do range (value 50) + nov 10 (7) + nov 12 (2) e filtro nov/2023: retorna 2 linhas com aggMonth=9 e **aggYear=59** (inclui o dia fora do range) | ✅ |

Teste 8 prova que `PARTITION BY month_trunc` separa corretamente outubro de novembro, e que `PARTITION BY year_trunc` agrega os dois.
Teste 9 prova que a semântica "full calendar" está correta: `aggYear` soma dias fora do range filtrado.

## 5. Exemplos de uso

```bash
# relatorio de um mes
curl -OJ "http://localhost:3001/metrics/report?metricId=218219&dateInitial=2023-11-01&finalDate=2023-11-30"

# relatorio do ano inteiro (dados so em nov, entao so 2 linhas)
curl -OJ "http://localhost:3001/metrics/report?metricId=218219&dateInitial=2023-01-01&finalDate=2023-12-31"
```

O flag `-OJ` do curl usa o filename do `Content-Disposition`.

## 6. Pendências / considerações

- **Streaming pro browser:** hoje geramos o buffer inteiro em memória e entregamos. Pra arquivos enormes (>50MB), `exceljs` suporta `stream.xlsx.WorkbookWriter` que escreve direto no response. Fica como melhoria — não cabe pra o volume esperado deste teste.
- **Cache de relatórios:** idempotência natural permite cache-by-URL. Seria fácil ligar Redis com chave = (metricId, range) e TTL curto. Pendente.
- **Permissão / autenticação:** endpoints abertos hoje. Qualquer melhoria de segurança (auth, rate limit) vale citar no README final.

---

**Status:** ✅ concluída e validada em 2026-04-16.
