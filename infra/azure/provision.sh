#!/usr/bin/env bash
# Provisiona toda a infra Azure pro deploy.
#
# Pre-requisitos:
#   - az CLI logado (`az login`)
#   - arquivo .env preenchido (copiar de .env.example)
#
# Uso:
#   cd infra/azure
#   cp .env.example .env      # preencha as vars
#   ./provision.sh

set -euo pipefail

# ------------------------------------------------------------
# 0. Carrega .env e valida
# ------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f .env ]]; then
  echo "ERRO: crie o arquivo .env (cp .env.example .env e preencha)."
  exit 1
fi

set -a; source .env; set +a

for v in AZURE_SUBSCRIPTION_ID AZURE_LOCATION AZURE_RESOURCE_GROUP AZURE_SUFFIX \
         PG_ADMIN_USER PG_ADMIN_PASSWORD CLOUDAMQP_URL; do
  if [[ -z "${!v:-}" ]]; then
    echo "ERRO: variavel $v nao definida em .env"
    exit 1
  fi
done

# Derivados
ACR_NAME="${AZURE_ACR_NAME:-gyacr$AZURE_SUFFIX}"
STORAGE="${AZURE_STORAGE_ACCOUNT:-gystore$AZURE_SUFFIX}"
PG_SERVER="${AZURE_PG_SERVER:-gypg$AZURE_SUFFIX}"
CAE_NAME="${AZURE_CAE_NAME:-gy-cae}"
BLOB_CONTAINER="${AZURE_STORAGE_CONTAINER:-csv-uploads}"
PG_DATABASE="${AZURE_PG_DATABASE:-gy_metrics}"

echo "========================================"
echo "Provisionamento Azure — plano"
echo "========================================"
echo "  Subscription: $AZURE_SUBSCRIPTION_ID"
echo "  Location:     $AZURE_LOCATION"
echo "  Resource Grp: $AZURE_RESOURCE_GROUP"
echo "  ACR:          $ACR_NAME"
echo "  Storage:      $STORAGE (container: $BLOB_CONTAINER)"
echo "  Postgres:     $PG_SERVER (db: $PG_DATABASE, user: $PG_ADMIN_USER)"
echo "  Container Env: $CAE_NAME"
echo "========================================"
read -rp "Confirmar provisionamento? (yes/no): " CONFIRM
[[ "$CONFIRM" == "yes" ]] || { echo "abortado"; exit 0; }

az account set --subscription "$AZURE_SUBSCRIPTION_ID"

# ------------------------------------------------------------
# 1. Resource Group
# ------------------------------------------------------------
echo ""
echo "[1/6] Resource Group..."
az group create \
  --name "$AZURE_RESOURCE_GROUP" \
  --location "$AZURE_LOCATION" \
  --output none
echo "  ✓ $AZURE_RESOURCE_GROUP"

# ------------------------------------------------------------
# 2. Azure Container Registry (pra guardar imagens Docker)
# ------------------------------------------------------------
echo ""
echo "[2/6] Azure Container Registry..."
az acr create \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$ACR_NAME" \
  --sku Basic \
  --admin-enabled true \
  --output none
ACR_LOGIN_SERVER=$(az acr show -n "$ACR_NAME" --query loginServer -o tsv)
echo "  ✓ $ACR_LOGIN_SERVER"

# ------------------------------------------------------------
# 3. Storage Account + Blob Container (substitui Azurite)
# ------------------------------------------------------------
echo ""
echo "[3/6] Storage Account..."
az storage account create \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$STORAGE" \
  --location "$AZURE_LOCATION" \
  --sku Standard_LRS \
  --kind StorageV2 \
  --output none

STORAGE_KEY=$(az storage account keys list \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --account-name "$STORAGE" \
  --query "[0].value" -o tsv)

STORAGE_CONN_STR=$(az storage account show-connection-string \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$STORAGE" \
  --query connectionString -o tsv)

az storage container create \
  --name "$BLOB_CONTAINER" \
  --account-name "$STORAGE" \
  --account-key "$STORAGE_KEY" \
  --output none
echo "  ✓ $STORAGE / container: $BLOB_CONTAINER"

# ------------------------------------------------------------
# 4. Postgres Flexible Server
# ------------------------------------------------------------
echo ""
echo "[4/6] Postgres Flexible Server (demora ~5-7 min)..."
az postgres flexible-server create \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$PG_SERVER" \
  --location "$AZURE_LOCATION" \
  --admin-user "$PG_ADMIN_USER" \
  --admin-password "$PG_ADMIN_PASSWORD" \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --storage-size 32 \
  --version 16 \
  --public-access All \
  --yes \
  --output none

# Regra especifica "AllowAzureServices" (0.0.0.0/0.0.0.0 tem tratamento
# especial no Azure — libera trafico vindo de outros servicos Azure).
az postgres flexible-server firewall-rule create \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$PG_SERVER" \
  --rule-name AllowAzureServices \
  --start-ip-address 0.0.0.0 \
  --end-ip-address 0.0.0.0 \
  --output none

az postgres flexible-server db create \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --server-name "$PG_SERVER" \
  --database-name "$PG_DATABASE" \
  --output none

PG_FQDN=$(az postgres flexible-server show \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$PG_SERVER" \
  --query fullyQualifiedDomainName -o tsv)
echo "  ✓ $PG_FQDN / db: $PG_DATABASE"

# ------------------------------------------------------------
# 5. Container Apps Environment
# ------------------------------------------------------------
echo ""
echo "[5/6] Container Apps Environment..."

# Precisa do provider Microsoft.App registrado na subscription
az provider register -n Microsoft.App --wait -o none 2>/dev/null || true
az provider register -n Microsoft.OperationalInsights --wait -o none 2>/dev/null || true

# Installa extensao se precisar
az extension add --name containerapp --upgrade --only-show-errors -o none 2>/dev/null || true

az containerapp env create \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$CAE_NAME" \
  --location "$AZURE_LOCATION" \
  --output none
echo "  ✓ $CAE_NAME"

# ------------------------------------------------------------
# 6. Salva dados gerados no .env pra proximos scripts
# ------------------------------------------------------------
echo ""
echo "[6/6] Atualizando .env com valores provisionados..."

update_env_var() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    echo "${key}=${value}" >> .env
  fi
}

update_env_var AZURE_ACR_NAME "$ACR_NAME"
update_env_var AZURE_ACR_LOGIN_SERVER "$ACR_LOGIN_SERVER"
update_env_var AZURE_STORAGE_ACCOUNT "$STORAGE"
update_env_var AZURE_STORAGE_CONNECTION_STRING "\"$STORAGE_CONN_STR\""
update_env_var AZURE_PG_SERVER "$PG_SERVER"
update_env_var AZURE_PG_FQDN "$PG_FQDN"
update_env_var AZURE_CAE_NAME "$CAE_NAME"
echo "  ✓ .env atualizado"

echo ""
echo "========================================"
echo "✅ Provisionamento completo!"
echo "========================================"
echo ""
echo "Próximos passos:"
echo "  1. ./build-push.sh   — builda e envia imagens Docker pra ACR"
echo "  2. ./deploy.sh       — cria/atualiza Container Apps com as imagens"
echo ""
