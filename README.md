# GreenYellow — Teste Full Stack

Teste técnico para vaga de Full Stack. O objetivo é receber um CSV de leituras de métricas, processar em background, armazenar no banco e expor endpoints de consulta (agregação por dia/mês/ano) e de relatório Excel. No front, uma interface para enviar o arquivo, consultar e baixar o relatório — com gráficos, KPIs, tabela paginada, dark mode e internacionalização.

## 🌐 Rodando em produção

Existe um deploy no Azure Container Apps em funcionamento:

- **Frontend:** https://gy-frontend.victoriousriver-e45d55dc.brazilsouth.azurecontainerapps.io
- **API (health):** https://gy-api.victoriousriver-e45d55dc.brazilsouth.azurecontainerapps.io/health
- **Swagger:** https://gy-api.victoriousriver-e45d55dc.brazilsouth.azurecontainerapps.io/api

Para testar a paginação sem precisar enviar um arquivo, há um dataset sintético pré-populado no banco. Na tela do front, utilize:

- **MetricId:** `999`
- **Data inicial:** `01-01-2024`
- **Data final:** `01-03-2024`
- **Granularidade:** `Dia`

São 60 pontos em 5 páginas. O seed (`db/seed-demo.sql`) gera 1440 leituras sintéticas para a métrica 999 cobrindo Jan-Fev/2024 — útil para testar manualmente cenários de tabela cheia que o `arquivo-modelo.csv` do enunciado (apenas dois dias de dados por métrica) não cobre. A métrica 999 é tratada como exceção no front: o botão Consultar fica liberado sem exigir upload, e, se houver arquivo em pré-visualização ou já enviado, ele é descartado antes da consulta (os resultados vêm do seed, não do arquivo).

## Como rodar localmente

**Pré-requisitos:** Docker e Docker Compose (v2+).

```bash
git clone git@github.com:caioalvess/greenyellow-fullstack-test.git
cd greenyellow-fullstack-test
cp .env.example .env
docker compose up -d
```

Na primeira execução o build das imagens leva aproximadamente 1 minuto; nas seguintes, segundos. Os serviços ficam em:

| Serviço | URL |
|---------|-----|
| Frontend | http://localhost:4200 |
| API | http://localhost:3001 |
| Swagger | http://localhost:3001/api |
| RabbitMQ UI | http://localhost:15672 (login `gy_user` / senha `gy_password`) |

### Usar

1. Abra o frontend.
2. Arraste (ou clique para selecionar) o `arquivo-modelo.csv` presente na raiz do repositório.
3. Uma pré-visualização aparece com metricId detectado, tamanho e intervalo de datas — clique em **Enviar** para confirmar o upload.
4. Os campos do formulário são preenchidos automaticamente com base no conteúdo do CSV.
5. Clique em **Consultar** para ver os resultados (gráfico ou tabela), ou em **Baixar Excel** para o relatório completo.

### (Opcional) Popular o banco com o dataset demo

```bash
docker exec -i gy-postgres psql -U gy_user -d gy_metrics < db/seed-demo.sql
```

Insere 1440 linhas para a métrica 999 (60 dias × 24h em Jan-Fev/2024). A operação é idempotente — pode ser executada várias vezes sem duplicar dados.

### Rodar os testes

```bash
docker compose exec api npm test        # backend (29 testes)
docker compose exec frontend npm test   # frontend (94 testes)
```

**123 testes no total.** O backend sobe um banco separado (`gy_metrics_test`) em 3 suítes (~10s); o frontend usa Jest + jsdom em 7 suítes (~25s). Detalhes de cobertura na seção *Testes* abaixo.

### Produção local

Para executar as imagens de produção (nginx servindo o front estático, backend compilado sem dev deps):

```bash
docker compose --profile prod up -d
```

O frontend de produção responde em `http://localhost:8080` e a API em `http://localhost:3003`. O profile `prod` coexiste com o dev (portas diferentes) para facilitar comparação.

### Parar

```bash
docker compose down       # mantém dados
docker compose down -v    # reseta tudo, inclusive banco
```

## Stack

- **Backend:** NestJS 10, TypeScript, Node 20, Swagger via `@nestjs/swagger`
- **Banco:** PostgreSQL 16 — entidades mapeadas via TypeORM, **consultas em SQL puro** (conforme o enunciado solicitou)
- **Fila:** RabbitMQ 3 via `amqplib` direto
- **Storage:** Azurite em dev, Azure Blob Storage em produção (mesma connection string, sem alteração no código)
- **Frontend:** Angular 17 + PrimeNG 17, Chart.js 4, tema custom com paleta da GreenYellow, dark mode com override explícito dos componentes PrimeNG, i18n pt-BR/en/es/fr via signals
- **Testes:** Jest no backend (unit + integração real + E2E com Supertest) e no frontend (jest-preset-angular + jsdom)
- **Infra:** Docker Compose em dev; Azure Container Apps em produção

## Fluxo

```
 ┌──────────────────┐         ┌─────────────┐
 │  Angular 17 SPA  │  HTTP   │  NestJS 10  │
 │     PrimeNG      ├────────>│    API      │
 └──────────────────┘         └──────┬──────┘
                      stream upload  │
                                     ▼
                              ┌──────────────┐
                              │   Azurite    │
                              │ / Azure Blob │◄── stream download
                              └──────┬───────┘            │
                    mensagem com     │                    │
                    nome do blob     ▼                    │
                              ┌──────────────┐            │
                              │  RabbitMQ    │            │
                              │ csv.uploaded │            │
                              └──────┬───────┘            │
                                     │ consume            │
                                     ▼                    │
                              ┌──────────────┐            │
                              │  Consumer    │────────────┘
                              │ csv-parse    │
                              │ streaming    │
                              └──────┬───────┘
                                     │ batch insert (1000 linhas)
                                     ▼
                              ┌──────────────┐
                              │ Postgres 16  │
                              │metric_readings
                              └──────────────┘
```

O upload é encaminhado via stream direto para o blob (a API não bufferiza o arquivo), publica uma mensagem com o nome do blob e responde `201` imediatamente. O consumer, em background, baixa o blob também em stream, faz o parse com `csv-parse` assíncrono e insere em lotes de 1000 linhas usando `ON CONFLICT DO NOTHING` para garantir idempotência. O front faz polling em `GET /uploads/:blobName/status` para exibir "processando… 45.000 linhas" em tempo real.

## Funcionalidades do frontend

- **Upload com pré-visualização** — ao soltar/selecionar um CSV, uma prévia aparece com o metricId detectado, nome do arquivo, tamanho e intervalo de datas. O envio só ocorre após confirmação.
- **Formulário de consulta** — metricId, intervalo de datas (com máscara `DD-MM-AAAA`), atalhos de período (Últimos 7 dias, Últimos 30 dias, Este mês, Este ano) e granularidade (Dia/Mês/Ano).
- **Resultados em dois modos** — tabela paginada (default, com dia da semana em chip) ou gráfico. Alternável em tempo real.
- **KPIs derivados** — Total (Σ, destaque em gradiente lime), Média (μ), Pico (▲, com data) e Mínimo (▼, com data). Computados client-side a partir do array devolvido pelo `/aggregate`.
- **Gráficos complementares** — gráfico principal (linha + área), distribuição (histograma de 8 faixas) e média por dia da semana (exibida apenas quando a granularidade é Dia).
- **Exportação de PNG** — individual por gráfico (botão com ícone) ou lote (botão "Baixar PNGs" na sidebar, visível apenas em modo gráfico).
- **Banner de resultados desatualizados** — se o formulário ou o arquivo são alterados após uma consulta, um aviso sutil aparece no topo do painel com botão "Refazer consulta".
- **Dark mode** — toggle no header do painel de resultados, com override explícito dos componentes PrimeNG (tabela, inputs, calendar, paginator) para evitar vazamento do tema claro.
- **Internacionalização** — quatro idiomas (pt-BR, en, es, fr), selector no header, persistência em `localStorage`, `<html lang>` atualizado reativamente.

## Principais decisões

**SQL puro nas queries, ORM apenas para modelagem.** O enunciado pediu preferência por SQL puro; o TypeORM cuida apenas do mapeamento da entidade. Todas as consultas (aggregate, report, insert em batch) usam `dataSource.query(sql, params)`.

**Tabela `metric_readings` crua**, sem pré-agregação. `UNIQUE (metric_id, date_time)` serve como dedupe e o índice composto é utilizado em todas as queries. O `EXPLAIN ANALYZE` confirma `Index Scan` em tempo sub-milissegundo para range de uma métrica.

**Streaming ponta a ponta.** Upload, download e parse. Testei com um CSV sintético de 31MB / 1.2M linhas e o pico de RAM da API ficou em **+53 MiB** sobre o baseline — independente do tamanho do arquivo. Isso resolveu um ponto que um colega que fez o mesmo teste havia alertado: o CSV de exemplo é pequeno, mas se o avaliador enviar um grande, buferizar tudo esgota a memória.

**Idempotência via `ON CONFLICT DO NOTHING`.** Reenvio ou reprocessamento não duplica linhas. Há testes explícitos para o cenário.

**Dedupe por SHA-256 antes da fila.** Com a versão inicial, o banco garantia idempotência via unique de `(metricId, dateTime)`, mas um reenvio do mesmo arquivo ainda gerava um blob novo no Azurite e desperdiçava um ciclo completo de parse + inserção (para tudo ser descartado pelo conflict). Adicionei um `Sha256PassThrough` (Transform stream que hasheia inline enquanto faz o pipe pro blob) e uma tabela `csv_uploads` com unique em `sha256`. O fluxo atualizado: o engine do Multer pipa o arquivo através do hasher pro Azurite; quando termina, o `UploadsService` consulta o hash no Postgres — se existir, **deleta o blob recém-uploaded** e responde `409 Conflict` com os metadados do upload original (`{existing: {originalName, uploadedAt, size}}`); se não existir, grava o registro e publica pra fila. Há também try/catch do unique constraint `23505` na escrita pra cobrir o caso de dois uploads simultâneos com o mesmo conteúdo (o primeiro grava, o segundo volta com 409). A stream continua sendo ponta a ponta — o hash não bufferiza nada. Testes cobrem: o `Sha256PassThrough` em isolado (3 casos) e o fluxo E2E de duplicata retornando 409 com `existing` preenchido. No front, o toast tratando o 409 usa severity `warn` ao invés de `error` pra não parecer falha — é o sistema recusando trabalho redundante, não um bug.

**Comportamento cumulativo entre múltiplos uploads.** O enunciado não aborda o que deve acontecer quando o usuário envia mais de um CSV — o exemplo mostra um arquivo só, e o endpoint `/metrics/aggregate` consulta "a métrica X no período Y", sem conceito de "upload ativo". Precisei decidir como tratar uploads subsequentes e optei por **acumulação com dedupe por `(metricId, dateTime)` — primeiro registro escrito prevalece**. Na prática: se você sobe um arquivo com 10 linhas e depois sobe o mesmo arquivo acrescido de 1 linha, o banco termina com 11 linhas (as 10 originais colidem no unique e são ignoradas, só a nova entra); se subir um segundo CSV do mesmo metricId com datas totalmente diferentes, o banco acumula o union dos dois; se as datas se sobrepõem com valores diferentes, os valores antigos permanecem (o reenvio não sobrescreve). Considerei as alternativas: (a) **substituir o range do upload** — deletar tudo do `(metricId, range do CSV)` antes de inserir; (b) **somar valores em colisão** — usar `ON CONFLICT DO UPDATE SET value = value + EXCLUDED.value`; (c) **atribuir cada upload a um "lote"** com id próprio e filtrar por lote na consulta. Todas têm casos de uso válidos, mas escolhi acumular porque é o comportamento padrão de sistemas de ingestão de séries temporais (InfluxDB, TimescaleDB, Prometheus): o banco é a fonte única da verdade, CSVs são deltas, e o aggregate reflete o estado total do banco. Isso também é o que torna o `ON CONFLICT DO NOTHING` idempotente de ponta a ponta — reupload acidental ou requeue do Rabbit não altera nada, o que é mais seguro do que "last-write-wins" em um pipeline assíncrono onde a ordem de processamento não é garantida. Deixo registrado porque entendo que, em um cenário real de produto, essa decisão mereceria ser validada com o time — talvez o usuário esperasse comportamento de "substituição" do último upload, e nesse caso a implementação seria diferente.

**Relatório Excel com window functions (sem `GROUP BY`).** Detalhado na seção "Diário de bordo".

**Consumer no mesmo processo do backend.** Simplifica o deploy (1 container em vez de 2). A separação lógica está feita (módulos distintos, interface por fila), então mover para um worker separado é trivial caso seja necessário escalar.

**Front Angular com signals + store central.** Um `MetricsStore` concentra todo o estado compartilhado (form, data, loading, status do upload, snapshot da última consulta). Os painéis de filtros e resultados apenas injetam `MetricsStore`. Zero prop-drilling.

**Polling de status do processamento.** Como a ingestão é assíncrona, o front precisa saber quando o banco já tem os dados. O endpoint `GET /uploads/:blobName/status` retorna `pending | processing | completed | failed` junto com a contagem de linhas processadas. O front consulta a cada 500ms e atualiza a UI em tempo real (exibe "Processando… 45.320 linhas" com barra de progresso amarela, muda para verde com checkmark ao concluir).

**Service de exportação dedicado.** O `ChartExportService` coordena o botão "Baixar PNGs" da sidebar com os canvases do painel de resultados — o painel registra uma função de export no service quando os gráficos estão em tela; a sidebar dispara o batch sem acoplamento direto entre componentes.

**Snapshot da última consulta.** O `lastQuery` guarda o estado do formulário + nome do arquivo no momento em que os resultados foram recebidos. O computed `isStale` compara esse snapshot apenas com o arquivo em **pré-visualização** (`pendingCsv`) — se há um CSV novo prestes a ser enviado cujo nome não bate com o do arquivo que gerou os resultados em tela, o banner aparece. Mexer em datas/metricId/granularidade sozinhos não dispara o aviso (era ruidoso: cada tecla na data atualizava a detecção). O foco do banner é "você está prestes a enviar um arquivo diferente — quer refazer a consulta?", não "qualquer coisa mudou no formulário".

**Persistência de sessão no `localStorage` com re-fetch do banco.** F5 não pode fazer o usuário perder o que ele estava vendo, mas o banco é a fonte da verdade — não faz sentido armazenar um snapshot dos dados no browser e arriscar mostrar números defasados. A solução é persistir apenas o **estado de navegação**: metricId, datas, granularidade, metadados do `lastUpload`/`uploadStatus`, e o `lastQuery`. Um `effect()` do Angular escuta todos esses signals e serializa em `gy.metrics.session.v1` (a versão no nome da chave invalida snapshots legados se o shape mudar). No `constructor` do `MetricsStore`, antes de registrar o effect, `hydrateFromStorage()` lê a chave e popula os signals; se havia `lastQuery`, dispara um `GET /metrics/aggregate` com aqueles parâmetros pra recarregar o array `data` direto do Postgres. O array em si **nunca** vai pro storage — sempre vem do banco. Snapshot corrompido, quota excedida ou storage indisponível são tratados como sessão vazia, sem toast de erro (o usuário não disparou nada). Na prática: o avaliador consulta, vê os gráficos, dá F5 e encontra exatamente o mesmo form preenchido + mesmos gráficos (com dado fresco), confirmando que nada é fake — tudo vem do banco, que persiste entre sessões porque o sistema é cumulativo.

**Swagger em `/api`.** Todos os endpoints (`/uploads`, `/uploads/:blobName/status`, `/metrics/aggregate`, `/metrics/report`, `/health`) documentados com DTOs decorados por `@ApiProperty`. O JSON puro do OpenAPI fica em `/api-json`, pronto para importação em Postman/Insomnia ou geração de SDK.

**Deploy com scripts shell.** Em `infra/azure/` há quatro scripts (`provision.sh`, `build-push.sh`, `deploy.sh`, `cleanup.sh`). Sem Terraform nem Bicep — apenas `az` CLI, mais legível para inspeção rápida e reproduzível.

## Testes

**113 testes no total**, divididos entre back e front.

### Backend — 29 testes, 4 suítes

| Suíte | Tipo | Casos |
|-------|------|-------|
| `csv-parser.util.spec.ts` | Unit | 9 |
| `hashing-stream.spec.ts` | Unit (SHA-256 pass-through) | 3 |
| `metrics.repository.spec.ts` | Integração com Postgres real | 13 |
| `pipeline.e2e.spec.ts` | E2E (AppModule + Rabbit + Azurite + DB) | 4 |

Executar: `docker compose exec api npm test`.

### Frontend — 94 testes, 7 suítes

| Suíte | Foco | Casos |
|-------|------|-------|
| `format.util.spec.ts` | Formatadores de data/bytes/número | 8 |
| `csv-meta.util.spec.ts` | Parser de metadados do CSV (BOM, CRLF, `;;`, chunk tail >64KB) | 7 |
| `api.service.spec.ts` | HTTP calls via `HttpTestingController` | 5 |
| `theme.service.spec.ts` | Tema com localStorage + effect no DOM (default light, ignora prefers-color-scheme) | 6 |
| `chart-export.service.spec.ts` | Register/unregister + batch export entre componentes | 6 |
| `i18n.service.spec.ts` | Locale inicial, persistência, `t()` com params, fallback para pt, missing key | 12 |
| `metrics.store.spec.ts` | Store central: computeds (total, kpis, histogram, weekdayMeans, isStale, isSubmittable), exceção metric 999, polling RxJS, upload preview, consultar (com pendingCsv e dedup), persistência + re-fetch | 50 |

Executar: `docker compose exec frontend npm test`.

## Diário de bordo

Fica um pouco mais pessoal porque o teste também avalia o processo.

**O CSV tem três armadilhas.** A primeira versão do parser falhou na linha 2 com "metricId undefined". O culpado era o **BOM UTF-8** no início do arquivo (corrompe o nome da primeira coluna). Corrigi e o parser falhou novamente na linha 93090 com "dateTime inválido". O problema dessa vez eram as **8 linhas `;;` vazias** de padding no final do CSV (comportamento do Excel ao exportar). Há também **CRLF** (Windows), esse já tratado pelo `csv-parse` por padrão. No final, o setup do parser ficou: `bom: true, skip_records_with_empty_values: true, delimiter: ';'`. Os três casos estão cobertos em testes explícitos para não regredir.

**Interpretei o Excel de forma equivocada duas vezes antes de acertar.** Analisei o PDF rapidamente demais e assumi que cada linha do Excel representava um dia agregado (um `GROUP BY day` com as window functions). A matemática batia com o exemplo pequeno do enunciado, mas algo incomodava: na tabela do PDF, o input é Nov-Dez/2023 e aparecem dias de **Janeiro/2024** na saída. Se houvesse filtro por range, isso não apareceria. Um colega que fez o mesmo teste me mostrou o Excel dele — **centenas de linhas idênticas para o mesmo dia**. Percebi então que o Excel não agrupa: é uma linha por leitura original do banco, com as agregações repetidas em cada linha do mesmo dia/mês/ano, via window function. Reescrevi a query (ficou mais simples, inclusive — apenas um `SELECT` com 3 `SUM() OVER (PARTITION BY ...)`, sem `GROUP BY` nem CTE). O resultado agora corresponde ao exemplo do PDF e ao output do colega.

**Azure CLI do Debian travado há mais de um ano.** O pacote `azure-cli` do repo APT da Microsoft para Debian 12 (bookworm) está em `2.45.0`, de fevereiro/2023. O script de deploy utiliza sintaxe que só existe a partir da 2.60+. Tentei `az upgrade`, `apt-get upgrade`, o script oficial `curl | bash` — todos apontam para o mesmo repositório travado. Solução: `pipx install azure-cli`, que baixa do PyPI direto. Deixei anotado em `infra/azure/README.md` caso o avaliador execute localmente.

**Azure free tier não tinha Postgres Flex em `eastus` para minha subscription.** `az postgres flexible-server list-skus --location eastus` retornou vazio. Mudei para `brazilsouth` (60+ SKUs disponíveis) e funcionou — como bônus, menos latência para o Brasil.

**O dark mode exigiu override explícito do PrimeNG.** O tema base `lara-light-blue` aplica `background: #ffffff` e `#f9fafb` em dezenas de componentes (tabela, inputs, paginator, calendar) sem passar pelas CSS vars. No dark mode, esses valores hardcoded vazavam e davam a sensação de "fundo claro atrás dos containers". A solução foi uma seção dedicada em `styles.scss` que sobrescreve manualmente cada componente usado, vinculando-os às variáveis `--gy-surface` e `--gy-surface-2` no dark.

**Render da tabela colapsava no novo layout.** O `.gy-table` global tinha `flex: 1 + overflow: hidden` no wrapper do p-datatable — pattern herdado do layout antigo em que o container tinha altura definida. No novo layout (sem chain de height), o wrapper colapsava e cortava 11 das 12 linhas da página. A solução foi transformar o comportamento antigo em uma classe opt-in (`.gy-table-fill`), deixando o default como size-to-content.

## Estrutura do repo

```
.
├── backend/                 # NestJS API
├── frontend/                # Angular + PrimeNG
├── db/
│   └── seed-demo.sql        # seed do metric 999 (demo de paginação)
├── infra/azure/             # scripts de deploy no Azure
├── docker-compose.yml
├── arquivo-modelo.csv       # arquivo de exemplo do enunciado
└── README.md
```

---

Qualquer dúvida sobre o código ou as decisões, estou à disposição.

— Caio Alves
