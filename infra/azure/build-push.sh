#!/usr/bin/env bash
# Builda backend + frontend em modo prod (multi-stage --target prod)
# e empurra as imagens pra Azure Container Registry.
#
# Uso: ./build-push.sh  (a partir de infra/azure/)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f .env ]]; then
  echo "ERRO: .env nao encontrado. Rode provision.sh primeiro."
  exit 1
fi
set -a; source .env; set +a

for v in AZURE_ACR_NAME AZURE_ACR_LOGIN_SERVER; do
  if [[ -z "${!v:-}" ]]; then
    echo "ERRO: $v nao encontrada em .env — rode provision.sh primeiro."
    exit 1
  fi
done

REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

TAG="${IMAGE_TAG:-v1}"
BACKEND_IMG="${AZURE_ACR_LOGIN_SERVER}/gy-backend:${TAG}"
FRONTEND_IMG="${AZURE_ACR_LOGIN_SERVER}/gy-frontend:${TAG}"

echo "========================================"
echo "Build + push das imagens Docker"
echo "========================================"
echo "  ACR:      $AZURE_ACR_LOGIN_SERVER"
echo "  Backend:  $BACKEND_IMG"
echo "  Frontend: $FRONTEND_IMG"
echo "========================================"

# Login no ACR (usa credenciais do az CLI)
echo ""
echo "[1/3] Autenticando no ACR..."
az acr login --name "$AZURE_ACR_NAME"

# Build backend
echo ""
echo "[2/3] Build backend (--target prod)..."
docker build \
  --target prod \
  -t "$BACKEND_IMG" \
  "$REPO_ROOT/backend"
docker push "$BACKEND_IMG"
echo "  ✓ $BACKEND_IMG"

# Build frontend
echo ""
echo "[3/3] Build frontend (--target prod)..."
docker build \
  --target prod \
  -t "$FRONTEND_IMG" \
  "$REPO_ROOT/frontend"
docker push "$FRONTEND_IMG"
echo "  ✓ $FRONTEND_IMG"

# Atualiza .env com as tags usadas
update_env_var() {
  local key="$1"; local value="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    echo "${key}=${value}" >> .env
  fi
}
update_env_var AZURE_BACKEND_IMG "$BACKEND_IMG"
update_env_var AZURE_FRONTEND_IMG "$FRONTEND_IMG"

echo ""
echo "========================================"
echo "✅ Imagens no ACR"
echo "========================================"
echo ""
echo "Próximo: ./deploy.sh"
