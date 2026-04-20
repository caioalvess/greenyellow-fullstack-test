# GreenYellow — Teste Full Stack

O objetivo é receber um CSV de leituras de métricas, processar em background, armazenar no banco e expor endpoints de consulta (agregação por dia/mês/ano) e de relatório Excel. No front, uma interface para enviar o arquivo, consultar e baixar o relatório — com gráficos, KPIs, tabela paginada, dark mode e internacionalização.

## Rodando em produção

Deploy no Azure Container Apps:

- **Frontend:** https://gy-frontend.victoriousriver-e45d55dc.brazilsouth.azurecontainerapps.io
- **API / Swagger:** https://gy-api.victoriousriver-e45d55dc.brazilsouth.azurecontainerapps.io/api

Para ver a UI com dados sem precisar subir nada, use **metricId=999, 01-01-2024 a 01-03-2024, Dia** — existe um seed com 60 dias × 24h pra essa métrica.

## Rodando localmente

Precisa Docker e Docker Compose (v2+).

```bash
git clone git@github.com:caioalvess/greenyellow-fullstack-test.git
cd greenyellow-fullstack-test
cp .env.example .env
docker compose up -d
```

Build leva ~1min na primeira vez. Serviços sobem em:

| Serviço | URL |
|---------|-----|
| Frontend | http://localhost:4200 |
| API / Swagger | http://localhost:3001/api |
| RabbitMQ UI | http://localhost:15672 (`gy_user` / `gy_password`) |

### Fluxo de uso

1. Abra o front.
2. Arraste o CSV (tem um em `greenwellow-test/arquivo-modelo.csv`).
3. Confirma no preview (ele já detecta metricId e intervalo de datas).
4. **Consultar** gera gráfico + tabela. **Baixar Excel** gera o relatório.

### Testes

```bash
docker compose exec api npm test        # backend
docker compose exec frontend npm test   # frontend
```

### Logs do pipeline

Cada etapa do fluxo tem um log com emoji pra ficar fácil de acompanhar (upload → hash → Azurite → fila → consumer → banco → consulta → cleanup).

```bash
docker logs -f gy-api                                                          # tudo
docker logs -f gy-api 2>&1 | grep -E '📥|🧮|☁️|✅|🚫|🔁|💾|📤|🔗|⬇️|📊|🧹|🔎|📈|❌|⚠️'   # só o pipeline
```

Exemplo do que sai num upload + consulta:

```
[UploadsService]     📥 upload recebido → arquivo.csv (2.34MB)
[UploadsService]     🧮 hash computado → sha256=a6e116fd32de…
[UploadsService]     ☁️  armazenado no Azurite → blob=<uuid>-arquivo.csv
[UploadsService]     ✅ dedup → hash inedito, segue o fluxo
[UploadsService]     🔁 substituicao → blob anterior removido do Azurite
[UploadsService]     💾 csv_uploads → registro salvo id=<uuid>
[UploadsService]     📤 rabbitmq → mensagem publicada na fila "csv.uploaded"
[CsvConsumerService] 📥 rabbitmq → mensagem consumida
[CsvConsumerService] 🔗 vinculado ao upload → id=<uuid> sha256=a6e116fd32de…
[CsvConsumerService] ⬇️  baixando stream do Azurite
[CsvConsumerService] 📊 parse → iniciando em lotes de 1000 linhas
[CsvConsumerService] ✅ processamento concluido → 93088/93088 linhas · 2143ms
[MetricsController]  🔎 aggregate → metricId=71412 range=2023-11-01..2023-12-31 gran=DAY
[MetricsRepository]  🧹 cleanup → removidas 0 leitura(s) e 0 upload(s) antigo(s)
[MetricsController]  📈 aggregate → 30 ponto(s) retornado(s)
```

### Parar

```bash
docker compose down       # mantém dados
docker compose down -v    # reseta tudo
```

## Stack

- **Backend:** NestJS 10, TypeScript, Node 20, Swagger via `@nestjs/swagger`
- **Banco:** PostgreSQL 16 — TypeORM só pro mapeamento de entidades, **queries em SQL puro**
- **Fila:** RabbitMQ 3 (amqplib direto, sem wrapper)
- **Storage:** Azurite em dev, Azure Blob Storage em prod (mesma connection string, mesmo código)
- **Frontend:** Angular 17 + PrimeNG 17, Chart.js 4, signals, dark mode, i18n pt-BR/en/es/fr
- **Infra:** Docker Compose em dev; Azure Container Apps em prod

## Fluxo

```
Upload (POST /uploads)
  Frontend ──stream──► API
                      │  ├─ SHA-256 inline (pass-through, sem bufferizar)
                      │  ├─ store no Azurite
                      │  └─ hash ja existe? ── SIM ──► 409, deleta blob novo
                      │                      └─ NAO ──► grava csv_uploads,
                      │                                 deleta blob anterior,
                      │                                 publica na fila
                      ▼
                    RabbitMQ (csv.uploaded)
                      │
                      ▼
                   Consumer
                      ├─ download stream do Azurite
                      ├─ parse em lotes de 1000
                      └─ INSERT metric_readings(..., csv_upload_id) ON CONFLICT DO NOTHING

Query (GET /metrics/aggregate, GET /metrics/report)
  ├─ cleanup: apaga linhas de uploads anteriores ao ativo
  ├─ SUM(value) agrupado por dia/mes/ano
  └─ devolve pontos
```

Upload responde `201` assim que o blob sobe + a mensagem entra na fila — o consumer processa em background. O front faz polling em `GET /uploads/:blobName/status` (500ms) pra mostrar "processando… 45.320 linhas" em tempo real.

## Funcionalidades do frontend

- **Upload com preview** — detecta metricId, intervalo de datas e contagem aproximada de linhas antes de enviar; prefill automático do form.
- **Formulário** — metricId, intervalo de datas (máscara `DD-MM-AAAA`), atalhos (últimos 7/30 dias, este mês, este ano) e granularidade Dia/Mês/Ano.
- **Resultados em dois modos** — tabela paginada ou gráfico, alternável na hora.
- **KPIs** — total, média, pico (com data) e mínimo (com data). Calculados no front em cima do array do `/aggregate`.
- **Gráficos extras** — distribuição em 8 faixas e média por dia-da-semana (só em granularidade Dia).
- **Exportação PNG** — gráfico individual ou todos em lote.
- **Banner "resultados desatualizados"** — aparece quando você subiu um arquivo novo mas ainda não re-consultou.
- **Dark mode** — override explícito dos componentes PrimeNG (o tema lara-light-blue tem background hardcoded em vários lugares).
- **i18n** — pt-BR / en / es / fr, selector no header, persiste em localStorage.
- **Persistência de sessão** — F5 não perde nada. Form + snapshot da última consulta ficam em localStorage; os dados em si vêm do banco via re-fetch no boot.

## Principais decisões

**Substituição por hash ao invés de acumulação.** O enunciado não diz o que acontece quando você sobe um segundo CSV: os dados somam? substituem? se multiplicam quando o conteúdo se sobrepõe? Adotei **um arquivo ativo por vez** com dedup por SHA-256 — o storage sempre tem exatamente 1 blob, e o banco substitui os dados na próxima query. Reenvio idêntico cai em `409 Conflict` cedo (hash batendo numa tabela `csv_uploads`), evitando stream + parse + insert de um arquivo que viraria no-op depois pelo unique no Postgres. Hash é calculado inline via um `Transform` stream (`Sha256PassThrough`), então o pipeline continua zero-buffer.

**Substituição em duas fases: storage eager, banco lazy.** No upload o Azurite já é atualizado (delete do blob anterior + store do novo), mas os dados do banco só são substituídos quando o usuário manda consultar. Isso porque enquanto o upload novo está em processamento, a tela ainda mostra a consulta anterior — mexer no banco cedo demais desalinharia UI e dados. O `cleanupStaleUploads()` roda como pré-passo em `/metrics/aggregate` e `/metrics/report`, apaga as linhas do upload anterior e segue com a query. Enquanto isso, o banner "resultados desatualizados" já avisa o usuário que tem dado novo esperando.

**Persistência no F5 com re-fetch do banco.** O enunciado mandou salvar no banco e no storage, então não fazia sentido o front descartar a sessão quando o usuário recarrega — a informação tá lá, só precisa ser buscada. O `MetricsStore` serializa o estado de navegação em `localStorage` (form + snapshot da última consulta — nunca os dados em si) via um `effect()` do Angular. No boot, um `hydrateFromStorage()` popula os signals e, se havia última consulta, dispara um GET pra o array vir **fresco** do Postgres. Snapshot corrompido ou storage indisponível caem silenciosamente numa sessão vazia.

**Streaming ponta a ponta.** Upload, hash, store no Azurite, download no consumer, parse e batch insert — tudo em stream. Pico de memória da API num CSV sintético de 31MB / 1.2M linhas ficou em +53MiB sobre o baseline, independente do tamanho. Se o avaliador decidir mandar um arquivo de 500MB, não estoura.

**SQL puro nas queries.** Enunciado pediu preferência e a escolha combinou com o caso: aggregate + report são 2 queries estáticas com window functions, não tem construção dinâmica que justificasse query builder. TypeORM continua responsável pelo mapeamento das entidades (`MetricReading`, `CsvUpload`) e pelo synchronize em dev.

## Pontos técnicos

**Storage engine custom pro Multer.** Em vez de `memoryStorage` (buffera tudo) ou `diskStorage` (escreve em /tmp), escrevi um `AzuriteStorageEngine` que pega o stream do campo multipart e pipa direto pro Azure via `blobClient.uploadStream`. O arquivo nunca é materializado na API — pico de RAM fica em O(chunk × concurrency) ≈ 20MB, não importa o tamanho do CSV.

**SHA-256 inline via Transform stream.** Um `Sha256PassThrough` (extends `Transform`) fica no meio do pipe — os bytes passam por ele a caminho do Azurite e `hash.update(chunk)` roda em cada chunk. Dois "consumers" da mesma stream sem duplicar leitura nem quebrar backpressure. No final, `hash.digest('hex')` entrega o SHA-256 pronto pra checagem de dedup.

**Report Excel com window functions puras.** O formato pedido (1 linha por leitura original + 3 colunas de agregação) não casa com `GROUP BY`. A query é um SELECT só com 3 `SUM(value) OVER (PARTITION BY metric_id, date_trunc('day'|'month'|'year', date_time))` — cada linha herda a agregação do próprio bucket sem precisar agrupar.

**Signals + store central no front, sem NgRx nem prop-drilling.** Um único `MetricsStore` (providedIn: root) guarda form, resultados, status de upload, `lastQuery` e `pendingCsv`. Os componentes só injetam e consomem — `total`, `kpis`, `histogram`, `weekdayMeans`, `isStale` e `isSubmittable` são `computed` em cima do state. Um `effect()` cuida da persistência em `localStorage` sem acoplamento.

**Consumer blindado contra corrida com o storage eager.** Como o blob anterior é deletado no upload novo, se o consumer tá atrasado processando o antigo quando isso acontece, ele pegaria um 404 do Azurite. O `csv-consumer.service.ts` trata esse caso + o de `csv_uploads` sem registro (mensagem remanescente de outra run): loga `warn`, chama `ack` e segue. Fila não trava, pipeline não quebra.

**Deploy com scripts shell + az CLI, sem Terraform.** `provision.sh`, `build-push.sh`, `deploy.sh`, `cleanup.sh` — 4 scripts curtos em `infra/azure/`. Mais fácil de inspecionar e reproduzir, sem lock state, sem provider dance.

## Melhorias futuras

- **Múltiplos arquivos ativos + cruzamento de dados.** A maior evolução seria abandonar o modelo "um arquivo por vez" e permitir que o usuário gerencie um acervo de uploads — subir vários CSVs, nomear/taguear, escolher em tempo de consulta quais incluir, cruzar métricas de arquivos diferentes num mesmo gráfico, comparar períodos. Exigiria uma tela de gerenciamento de uploads, filtros por upload no `/aggregate` e provavelmente alguma UI de comparação (dois gráficos lado a lado, diff de valores).
- **Worker separado pro consumer.** Hoje o consumer roda no mesmo processo da API pra simplificar o deploy. Escalando, separar num container dedicado deixa upload/query e ingest independentes — a API não trava sob carga de processamento e o worker pode ter replicas horizontalmente.
- **DLQ + retries exponenciais no Rabbit.** Hoje mensagem com erro no consumer é descartada (`nack(false, false)`). Em produção séria, o ideal é requeue com backoff + dead letter queue pra inspeção manual. Azure AMQP Service Bus já suporta nativamente; no RabbitMQ precisa de plugin ou shovel.
