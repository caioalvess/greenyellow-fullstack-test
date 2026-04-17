#!/usr/bin/env bash
# Cria/atualiza os Container Apps (backend + frontend) no ambiente
# provisionado, com env vars apontando pros servicos Azure reais.
#
# Uso: ./deploy.sh  (a partir de infra/azure/)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f .env ]]; then
  echo "ERRO: .env nao encontrado."
  exit 1
fi
set -a; source .env; set +a

REQUIRED=(
  AZURE_RESOURCE_GROUP AZURE_CAE_NAME AZURE_ACR_NAME AZURE_ACR_LOGIN_SERVER
  AZURE_BACKEND_IMG AZURE_FRONTEND_IMG
  AZURE_PG_FQDN AZURE_PG_DATABASE PG_ADMIN_USER PG_ADMIN_PASSWORD
  AZURE_STORAGE_CONNECTION_STRING AZURE_STORAGE_CONTAINER
  CLOUDAMQP_URL
)
for v in "${REQUIRED[@]}"; do
  if [[ -z "${!v:-}" ]]; then
    echo "ERRO: $v nao definida em .env."
    exit 1
  fi
done

BACKEND_APP="${AZURE_BACKEND_APP:-gy-api}"
FRONTEND_APP="${AZURE_FRONTEND_APP:-gy-frontend}"

# Credenciais do ACR (admin) pra Container Apps puxar as imagens
ACR_USER=$(az acr credential show --name "$AZURE_ACR_NAME" --query username -o tsv)
ACR_PASS=$(az acr credential show --name "$AZURE_ACR_NAME" --query "passwords[0].value" -o tsv)

echo "========================================"
echo "Deploy Container Apps"
echo "========================================"
echo "  Env:       $AZURE_CAE_NAME"
echo "  Backend:   $BACKEND_APP <- $AZURE_BACKEND_IMG"
echo "  Frontend:  $FRONTEND_APP <- $AZURE_FRONTEND_IMG"
echo "========================================"

# ------------------------------------------------------------
# 1. Backend Container App
# ------------------------------------------------------------
echo ""
echo "[1/3] Deploy backend..."

# --cors-origin * por ora; travaremos no passo 3 depois que o front
# tem FQDN conhecido.
if az containerapp show -g "$AZURE_RESOURCE_GROUP" -n "$BACKEND_APP" &>/dev/null; then
  echo "  atualizando app existente..."
  az containerapp update \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$BACKEND_APP" \
    --image "$AZURE_BACKEND_IMG" \
    --set-env-vars \
      "PORT=3000" \
      "NODE_ENV=production" \
      "POSTGRES_HOST=$AZURE_PG_FQDN" \
      "POSTGRES_PORT=5432" \
      "POSTGRES_USER=$PG_ADMIN_USER" \
      "POSTGRES_PASSWORD=secretref:pg-password" \
      "POSTGRES_DB=$AZURE_PG_DATABASE" \
      "POSTGRES_SSL=true" \
      "RABBITMQ_URL=secretref:amqp-url" \
      "AZURITE_CONNECTION_STRING=secretref:storage-conn" \
      "BLOB_CONTAINER=$AZURE_STORAGE_CONTAINER" \
      "CORS_ORIGIN=*" \
    --output none
else
  echo "  criando app novo..."
  az containerapp create \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --environment "$AZURE_CAE_NAME" \
    --name "$BACKEND_APP" \
    --image "$AZURE_BACKEND_IMG" \
    --registry-server "$AZURE_ACR_LOGIN_SERVER" \
    --registry-username "$ACR_USER" \
    --registry-password "$ACR_PASS" \
    --target-port 3000 \
    --ingress external \
    --min-replicas 1 \
    --max-replicas 1 \
    --cpu 0.5 \
    --memory 1Gi \
    --secrets \
      "pg-password=$PG_ADMIN_PASSWORD" \
      "amqp-url=$CLOUDAMQP_URL" \
      "storage-conn=$AZURE_STORAGE_CONNECTION_STRING" \
    --env-vars \
      "PORT=3000" \
      "NODE_ENV=production" \
      "POSTGRES_HOST=$AZURE_PG_FQDN" \
      "POSTGRES_PORT=5432" \
      "POSTGRES_USER=$PG_ADMIN_USER" \
      "POSTGRES_PASSWORD=secretref:pg-password" \
      "POSTGRES_DB=$AZURE_PG_DATABASE" \
      "POSTGRES_SSL=true" \
      "RABBITMQ_URL=secretref:amqp-url" \
      "AZURITE_CONNECTION_STRING=secretref:storage-conn" \
      "BLOB_CONTAINER=$AZURE_STORAGE_CONTAINER" \
      "CORS_ORIGIN=*" \
    --output none
fi

BACKEND_FQDN=$(az containerapp show \
  -g "$AZURE_RESOURCE_GROUP" -n "$BACKEND_APP" \
  --query properties.configuration.ingress.fqdn -o tsv)
BACKEND_URL="https://${BACKEND_FQDN}"
echo "  ✓ backend: $BACKEND_URL"

# ------------------------------------------------------------
# 2. Frontend Container App
# ------------------------------------------------------------
echo ""
echo "[2/3] Deploy frontend..."

if az containerapp show -g "$AZURE_RESOURCE_GROUP" -n "$FRONTEND_APP" &>/dev/null; then
  echo "  atualizando app existente..."
  az containerapp update \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$FRONTEND_APP" \
    --image "$AZURE_FRONTEND_IMG" \
    --set-env-vars "API_BASE=$BACKEND_URL" \
    --output none
else
  echo "  criando app novo..."
  az containerapp create \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --environment "$AZURE_CAE_NAME" \
    --name "$FRONTEND_APP" \
    --image "$AZURE_FRONTEND_IMG" \
    --registry-server "$AZURE_ACR_LOGIN_SERVER" \
    --registry-username "$ACR_USER" \
    --registry-password "$ACR_PASS" \
    --target-port 80 \
    --ingress external \
    --min-replicas 1 \
    --max-replicas 1 \
    --cpu 0.25 \
    --memory 0.5Gi \
    --env-vars "API_BASE=$BACKEND_URL" \
    --output none
fi

FRONTEND_FQDN=$(az containerapp show \
  -g "$AZURE_RESOURCE_GROUP" -n "$FRONTEND_APP" \
  --query properties.configuration.ingress.fqdn -o tsv)
FRONTEND_URL="https://${FRONTEND_FQDN}"
echo "  ✓ frontend: $FRONTEND_URL"

# ------------------------------------------------------------
# 3. Trava o CORS do backend na URL exata do frontend
# ------------------------------------------------------------
echo ""
echo "[3/3] Ajustando CORS_ORIGIN do backend pra FQDN do frontend..."
az containerapp update \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$BACKEND_APP" \
  --set-env-vars "CORS_ORIGIN=$FRONTEND_URL" \
  --output none
echo "  ✓ CORS restrito a $FRONTEND_URL"

echo ""
echo "========================================"
echo "✅ Deploy completo!"
echo "========================================"
echo ""
echo "🌐 Frontend:  $FRONTEND_URL"
echo "🔗 API:       $BACKEND_URL/health"
echo ""
echo "Seed do demo (metric 999) — roda UMA vez pra popular:"
echo "  ./seed-demo.sh"
echo ""
echo "Pra destruir tudo e parar de gastar credito:"
echo "  ./cleanup.sh"
