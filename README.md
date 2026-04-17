# GreenYellow — Teste Full Stack

Teste técnico pra vaga de Full Stack. O objetivo é receber um CSV de leituras de métricas, processar em background, guardar no banco e expor endpoints de consulta (agregação por dia/mês/ano) e relatório Excel. Do lado do front, uma tela simples pra subir o arquivo, consultar e baixar o relatório.

## 🌐 Rodando em produção

Tem um deploy no Azure funcionando:

- **Frontend:** https://gy-frontend.victoriousriver-e45d55dc.brazilsouth.azurecontainerapps.io
- **API (health):** https://gy-api.victoriousriver-e45d55dc.brazilsouth.azurecontainerapps.io/health

Pra testar paginação sem precisar subir arquivo, já tem um dataset sintético pré-populado no banco. Na tela do front, use:

- **MetricId:** `999`
- **Data inicial:** `01-01-2024`
- **Data final:** `01-03-2024`
- **Granularidade:** `Dia`

São 60 pontos em 5 páginas. Esse seed (`db/seed-demo.sql`) gera 1440 leituras sintéticas pra métrica 999 cobrindo Jan-Fev/2024 — serviu muito pra testar manualmente cenários de tabela cheia que o `arquivo-modelo.csv` do enunciado (só 2 dias de dados pra cada métrica) não cobre. Deixei como exceção no front: quando o MetricId é 999, o botão Consultar libera sem exigir upload.

## Como rodar local

**Pré-requisitos:** Docker e Docker Compose (v2+). Só isso.

```bash
git clone git@github.com:caioalvess/greenyellow-fullstack-test.git
cd greenyellow-fullstack-test
cp .env.example .env
docker compose up -d
```

Na primeira vez demora ~1 min fazendo build das imagens. Depois sobe em segundos. Tudo pronto nesses endereços:

| Serviço | URL |
|---------|-----|
| Frontend | http://localhost:4200 |
| API | http://localhost:3001 |
| RabbitMQ UI | http://localhost:15672 (login `gy_user` / senha `gy_password`) |

### Usar

1. Abre o frontend.
2. Arrasta (ou clica pra selecionar) o `arquivo-modelo.csv` que tá na raiz do repo.
3. Os campos do formulário preenchem sozinhos com base no conteúdo do CSV.
4. Clica **Consultar** pra ver a tabela agregada, ou **Baixar Excel** pro relatório completo.

### (Opcional) Popular o banco com o dataset demo

```bash
docker exec -i gy-postgres psql -U gy_user -d gy_metrics < db/seed-demo.sql
```

1440 linhas pra metric 999 (60 dias × 24h em Jan-Fev/2024). Idempotente — pode rodar várias vezes sem duplicar.

### Rodar os testes

```bash
docker compose exec api npm test
```

25 testes — sobem um DB separado (`gy_metrics_test`), 3 suítes, ~8 segundos.

### Produção local

Se quiser subir as imagens de produção (nginx servindo o front, backend compilado sem dev deps):

```bash
docker compose --profile prod up -d
```

Frontend prod vai pra `http://localhost:8080`, API prod pra `http://localhost:3003`. O profile `prod` coexiste com o dev (portas diferentes) pra facilitar comparação.

### Parar

```bash
docker compose down       # mantém dados
docker compose down -v    # reseta tudo, inclusive banco
```

## Stack

- **Backend:** NestJS 10, TypeScript, Node 20
- **Banco:** PostgreSQL 16 — entidades via TypeORM, **queries em SQL puro** (como o enunciado pediu)
- **Fila:** RabbitMQ 3 via `amqplib` direto
- **Storage:** Azurite em dev, Azure Blob Storage real em prod (mesma connection string, zero mudança de código)
- **Frontend:** Angular 17 + PrimeNG 17 (fonte Nunito, tema custom com paleta da GreenYellow, dark mode)
- **Testes:** Jest + Supertest
- **Infra:** Docker Compose em dev; Azure Container Apps em prod

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

Upload streama direto pro blob (a API nunca bufera o arquivo), publica uma mensagem com o nome do blob e responde `201` na hora. O consumer, em background, baixa o blob também como stream, parseia com `csv-parse` async e insere em batches de 1000 linhas usando `ON CONFLICT DO NOTHING` pra garantir idempotência. O front fica fazendo polling num endpoint de status (`GET /uploads/:blobName/status`) pra mostrar "processando… 45.000 linhas" em tempo real.

## Principais decisões

**SQL puro nas queries, ORM só pra modelagem.** O enunciado pediu preferência por SQL puro; TypeORM cuida só do mapeamento da entidade. Todas as consultas (aggregate, report, insert em batch) usam `dataSource.query(sql, params)`.

**Tabela `metric_readings` crua**, sem pré-agregação. `UNIQUE (metric_id, date_time)` serve de dedupe e o índice composto é usado em todas as queries. O `EXPLAIN ANALYZE` confirma `Index Scan` sub-1ms pra range de um metric.

**Streaming ponta a ponta.** Upload, download e parse. Testei com um CSV sintético de 31MB / 1.2M linhas e o pico de RAM da API ficou em **+53 MiB** sobre o baseline — independente do tamanho do arquivo. Isso resolveu um ponto que um colega que fez o mesmo teste tinha me alertado (o CSV de exemplo é pequeno, mas se o examinador subir um grande, bufferizar tudo morre).

**Idempotência por `ON CONFLICT DO NOTHING`.** Reupload ou reprocessamento não duplica. Testado.

**Relatório Excel com window functions (sem `GROUP BY`).** Esse foi o pulo do gato — explicado mais abaixo na seção "O que deu trabalho".

**Consumer no mesmo processo do backend.** Simplifica o deploy (1 container ao invés de 2). A separação lógica tá feita (módulos distintos, interface por fila), então mover pra worker separado é trivial se precisar escalar.

**Front Angular com signals + store central.** Um `MetricsStore` concentra todo o estado compartilhado (form, data, loading, status do upload). Os painéis de filtros e resultados só fazem `inject(MetricsStore)`. Zero prop-drilling.

**Polling de status do processamento.** Como a ingestão é assíncrona, o front precisa saber quando o banco já tem os dados. Implementei um endpoint `GET /uploads/:blobName/status` que retorna `pending | processing | completed | failed` + contagem de linhas processadas. O front polla a cada 500ms e atualiza a UI em tempo real (mostra "Processando… 45.320 linhas" com barra de progresso amarela, muda pra verde com checkmark quando completa).

**Deploy com scripts shell.** Em `infra/azure/` tem 4 scripts (`provision.sh`, `build-push.sh`, `deploy.sh`, `cleanup.sh`). Sem Terraform, sem Bicep, só `az` CLI — mais legível pra alguém inspecionar rapidamente, e reproduzível.

## Testes

25 testes, 3 suítes:

| Suíte | Tipo | Casos |
|-------|------|-------|
| `csv-parser.util.spec.ts` | Unit | 9 |
| `metrics.repository.spec.ts` | Integração com Postgres real | 13 |
| `pipeline.e2e.spec.ts` | E2E (sobe o AppModule + Rabbit + Azurite + DB) | 3 |

Rodar: `docker compose exec api npm test`.

### O que **não** foi testado e por quê

- **Renderização visual dos componentes Angular.** Precisaria de Playwright ou Karma — adiciona ~300MB de deps pra validar ~2 componentes simples. A camada de lógica deles já tá coberta pelo backend (E2E) e o próprio `ng build` pega problemas de tipo/template. Validação visual ficou como walkthrough manual no browser (documentado em `docs/fase-6-frontend-angular.md`).
- **Cenários de falha de infra** (Rabbit cai, Postgres derruba conexão no meio). Precisa de toxiproxy/chaos tools pra simular direito; ROI baixo pro escopo. O código já tem os handlers certos (try/catch + nack, client.end() em finally) e o `ON CONFLICT` cobre reprocessamento.
- **Carga com arquivo enorme.** Validado manualmente com 1.2M linhas (+53MiB de pico) — automatizar no Jest seria lento (~90s) e depende de hardware. Documentado.

## O que deu trabalho — diário de bordo

Fica um pouco mais pessoal porque o teste também avalia o processo.

**O CSV tem 3 armadilhas.** Minha primeira versão do parser morreu na linha 2 com "metricId undefined". Era o **BOM UTF-8** no início do arquivo (corrompe o nome da primeira coluna). Arrumei e morreu de novo na linha 93090 com "dateTime invalido". Eram as **8 linhas `;;` vazias** de padding no final do CSV (coisa do Excel quando exporta). Tem também **CRLF** (Windows), esse o `csv-parse` já trata por padrão. No final, o setup do parser ficou: `bom: true, skip_records_with_empty_values: true, delimiter: ';'`. Cobri esses 3 casos em testes explícitos pra não voltar atrás.

**Interpretei o Excel errado duas vezes antes de acertar.** Olhei o PDF rápido demais e assumi que cada linha do Excel era um dia agregado (um `GROUP BY day` com as window functions). A matemática batia com o exemplo pequeno do enunciado, mas algo me incomodava: na tabela do PDF, o input é Nov-Dez/2023 e aparecem dias de **Janeiro/2024** na saída. Se tivesse filtro por range, isso não apareceria. Um colega que fez o mesmo teste me mostrou o Excel dele — **centenas de linhas idênticas pro mesmo dia**. Caiu a ficha: o Excel não agrupa. É uma linha por leitura original do banco, com as agregações repetidas em cada linha do mesmo dia/mês/ano, via window function. Reescrevi a query (ficou mais simples, inclusive — só um `SELECT` com 3 `SUM() OVER (PARTITION BY ...)`, sem `GROUP BY` nem `CTE`). Agora bate com o exemplo do PDF e com o output do colega.

**Azure CLI do Debian tá travado há mais de um ano.** O pacote `azure-cli` do repo APT do Microsoft pra Debian 12 (bookworm) está em `2.45.0`, de fevereiro/2023. Meu script de deploy usa sintaxe que só existe em 2.60+. Tentei `az upgrade`, `apt-get upgrade`, o script oficial `curl | bash` — nada, todos apontam pro mesmo repo travado. Solução: `pipx install azure-cli`, que puxa do PyPI direto. Deixei anotado no `infra/azure/README.md` pra caso o avaliador rode local.

**Azure free tier não tinha Postgres Flex no `eastus` pra minha subscription.** `az postgres flexible-server list-skus --location eastus` veio vazio. Mudei pra `brazilsouth` (tinha 60+ SKUs) e foi — bônus, menos latência do Brasil.

**Mexer no layout do front foi mais chato do que o back.** Acabei reconstruindo o layout umas 3 vezes — `sticky` conflitava com `align-items: stretch`, paginação crescendo puxava o painel esquerdo junto, skeleton piscava durante a transição. A solução final usa `align-items: stretch` no grid (ambos os painéis ganham a altura do maior sem hardcode de pixel) + reduzir o `rows` da paginação pra garantir que o direito nunca ultrapassa o natural do esquerdo. A tabela tem uma animação de stagger fade-in (rows aparecem em cascata de 40ms) e uma barra verde fluindo no topo durante loading.

## Melhorias futuras

Coisas que eu faria se fosse seguir mantendo em produção:

- **Migrations TypeORM** em vez de `synchronize: true`. Dev só.
- **Dead Letter Queue** no RabbitMQ + retry com backoff. Hoje o consumer faz `nack(requeue=false)` em erro, então se o parse falhar por bug, a mensagem é descartada depois de logar.
- **Persistir `UploadStatusStore` em Redis** (hoje é in-memory, perde em restart). Pro escopo do teste tá ok.
- **Stream do Excel direto no response** com `exceljs.stream.xlsx.WorkbookWriter`. Hoje bufera na memória — bom pra arquivos <10MB, ruim acima.
- **Auth** (JWT ou OAuth). Endpoints abertos — fora de escopo do enunciado mas óbvio pra prod real.
- **Teste E2E do front** com Playwright em job de CI separado.

## Estrutura do repo

```
.
├── backend/                 # NestJS API
├── frontend/                # Angular + PrimeNG
├── db/
│   └── seed-demo.sql        # seed do metric 999 (demo de paginação)
├── infra/azure/             # scripts de deploy no Azure
├── docs/                    # doc detalhada por fase (opcional)
├── docker-compose.yml
├── arquivo-modelo.csv       # arquivo de exemplo do enunciado
└── README.md
```

A pasta `docs/` tem uma página por fase com decisões e trade-offs em mais detalhe — fica como leitura opcional pra quem quiser entender o processo em profundidade. Esse README cobre o essencial.

---

Qualquer dúvida sobre o código ou decisões, eu tô aqui.

— Caio Alves
