# Deploy Azure

Scripts pra deployar a stack inteira no Azure Container Apps.

## Pré-requisitos

- Azure CLI instalado e logado (`az login`)
- Docker rodando local
- Conta CloudAMQP com instance "Little Lemur" (free) criada — copie a **AMQP URL**

## Passo a passo

### 1. Configurar `.env`

```bash
cd infra/azure
cp .env.example .env
# edite .env: preencha AZURE_SUFFIX (ex: suas iniciais+numero), PG_ADMIN_PASSWORD, CLOUDAMQP_URL
```

### 2. Provisionar infra (~10 min)

```bash
./provision.sh
```

Cria: Resource Group, Container Registry, Storage Account + container, Postgres Flexible Server + database, Container Apps Environment.

Atualiza `.env` automaticamente com os valores gerados.

### 3. Build + Push das imagens (próximo — ainda a implementar)

```bash
./build-push.sh
```

Builda backend e frontend em modo prod (multi-stage Dockerfile) e pusha pra ACR.

### 4. Deploy dos Container Apps (próximo — ainda a implementar)

```bash
./deploy.sh
```

Cria os 2 Container Apps (backend + frontend) conectados à infra.

### 5. Teardown completo

```bash
./cleanup.sh  # deleta o Resource Group inteiro
```

## Arquitetura no Azure

```
                    ┌─────────────────────────────┐
                    │  Azure Container Apps Env   │
                    │  ┌───────────────────────┐  │
    usuário ────►   │  │  gy-frontend (nginx)  │◄─┼─── static
                    │  └──────────┬────────────┘  │
                    │             │ HTTP          │
                    │  ┌──────────▼────────────┐  │
                    │  │  gy-api (NestJS prod) │  │
                    │  └──────────┬────────────┘  │
                    └─────────────┼───────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
     ┌────────────────┐  ┌────────────────┐  ┌─────────────────┐
     │ Azure Storage  │  │ Azure Database │  │   CloudAMQP     │
     │  (Blob)        │  │  for Postgres  │  │   (external)    │
     └────────────────┘  └────────────────┘  └─────────────────┘
```

- **Blob Storage** substitui o Azurite local (mesma API do SDK, `AZURITE_CONNECTION_STRING` nomeada legado mas aponta pro Azure real).
- **Postgres Flexible Server** substitui o container postgres local.
- **CloudAMQP** fica fora do Azure (Azure não tem RabbitMQ nativo compatível com amqplib).
- **Container Registry** guarda as imagens Docker buildadas do `--target prod` dos Dockerfiles.

## Custos estimados

Com $200 de crédito do Free Trial:

| Recurso | Custo/mês |
|---------|-----------|
| ACR Basic | ~$5 |
| Postgres Flex B1ms + 32GB | ~$15 |
| Storage Standard LRS | <$1 |
| Container Apps (backend + front, scale min 1) | ~$10-20 |
| CloudAMQP Little Lemur | FREE |
| **Total** | **~$30-40/mês** |

Crédito dura **~5 meses** se deixar rodando, o que sobra pra avaliação.

## Limpeza ao final da avaliação

```bash
./cleanup.sh
# ou manualmente:
az group delete --name gy-teste --yes --no-wait
```

Deletar o Resource Group apaga TUDO que foi criado — zero custo residual.
