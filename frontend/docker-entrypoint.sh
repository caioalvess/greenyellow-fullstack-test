#!/bin/sh
# Entrypoint do container frontend (nginx prod).
# Reescreve assets/config.js com a env var API_BASE antes de subir o nginx.
# Isso permite usar a MESMA imagem Docker em dev/staging/prod, apenas
# mudando a URL da API via env var no Container App.

set -e

API_BASE="${API_BASE:-http://localhost:3001}"
CONFIG_PATH="/usr/share/nginx/html/assets/config.js"

cat > "$CONFIG_PATH" <<EOF
// Gerado pelo docker-entrypoint.sh em runtime.
window.__API_BASE__ = "${API_BASE}";
EOF

echo "[entrypoint] API_BASE = ${API_BASE}"

exec nginx -g "daemon off;"
