#!/usr/bin/env bash
# Destroi todos os recursos criados pelo provision.sh.
# Apaga o Resource Group inteiro — operacao irreversivel.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f .env ]]; then
  echo "ERRO: .env nao encontrado."
  exit 1
fi
set -a; source .env; set +a

echo "⚠️  Isso vai DELETAR o resource group \"$AZURE_RESOURCE_GROUP\" inteiro:"
echo "    - Container Apps (backend + frontend)"
echo "    - Container Registry + imagens"
echo "    - Postgres Flexible Server + banco + dados"
echo "    - Storage Account + blobs"
echo "    - Container Apps Environment"
echo ""
read -rp "Digite o nome do resource group pra confirmar: " CONFIRM

if [[ "$CONFIRM" != "$AZURE_RESOURCE_GROUP" ]]; then
  echo "abortado"
  exit 0
fi

echo ""
echo "Deletando em background (nao bloqueia o terminal)..."
az group delete \
  --name "$AZURE_RESOURCE_GROUP" \
  --yes \
  --no-wait

echo "✓ Comando de delete disparado. Conclusao em ~5-10 min."
echo "  Pra acompanhar: az group show --name $AZURE_RESOURCE_GROUP"
echo "  (quando retornar 'ResourceGroupNotFound', terminou)"
