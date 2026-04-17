#!/usr/bin/env bash
# Popula o Postgres Azure com os dados sinteticos do metric 999
# (60 dias × 24 horas pra demonstrar paginacao).
# Mesmo SQL que db/seed-demo.sql, so que aplicado via psql contra Azure PG.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f .env ]]; then
  echo "ERRO: .env nao encontrado."
  exit 1
fi
set -a; source .env; set +a

REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SEED_FILE="$REPO_ROOT/db/seed-demo.sql"

if [[ ! -f "$SEED_FILE" ]]; then
  echo "ERRO: $SEED_FILE nao encontrado."
  exit 1
fi

if ! command -v psql &>/dev/null; then
  echo "ERRO: psql nao instalado. Instale com:"
  echo "  sudo apt-get install -y postgresql-client"
  exit 1
fi

echo "Aplicando seed demo no Postgres Azure..."
echo "  Host: $AZURE_PG_FQDN"
echo "  DB:   $AZURE_PG_DATABASE"
echo ""

PGPASSWORD="$PG_ADMIN_PASSWORD" psql \
  --host="$AZURE_PG_FQDN" \
  --username="$PG_ADMIN_USER" \
  --dbname="$AZURE_PG_DATABASE" \
  --set=sslmode=require \
  -f "$SEED_FILE"

echo ""
echo "✅ Seed aplicado. Metric 999 agora tem 1440 leituras (60 dias × 24h)."
echo "   Consulte no front com: metricId=999, datas 01-01-2024 a 01-03-2024."
