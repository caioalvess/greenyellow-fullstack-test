// Config de runtime. Em dev (ng serve) este fallback aplica.
// Em prod (nginx container), o docker-entrypoint.sh sobrescreve este arquivo
// baseado na env var API_BASE do Container App.
window.__API_BASE__ = window.__API_BASE__ || 'http://localhost:3001';
