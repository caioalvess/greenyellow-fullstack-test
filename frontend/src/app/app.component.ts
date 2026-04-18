import { Component, computed, inject } from '@angular/core';
import { ToastModule } from 'primeng/toast';
import { FiltersPanelComponent } from './filters-panel/filters-panel.component';
import { ResultsPanelComponent } from './results-panel/results-panel.component';
import { MetricsStore } from './metrics.store';
import { ThemeService } from './theme.service';
import { I18nService } from './i18n/i18n.service';
import { LanguageSelectorComponent } from './i18n/language-selector.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    ToastModule,
    FiltersPanelComponent,
    ResultsPanelComponent,
    LanguageSelectorComponent,
  ],
  template: `
    <p-toast position="top-right" />

    <header class="gy-header" role="banner">
      <div class="gy-header-inner">
        <a class="brand" href="/" [attr.aria-label]="i18n.t('header.brand.aria')">
          <img
            src="assets/logo.svg"
            alt="GreenYellow"
            class="brand-logo"
            width="178"
            height="48"
          />
          <span class="brand-divider" aria-hidden="true"></span>
          <span class="brand-sub">{{ i18n.t('header.brand.subtitle') }}</span>
        </a>

        <div class="header-right">
          <span class="meta" aria-live="polite">
            @if (lastUploadLabel(); as label) {
              <i class="pi pi-check-circle" aria-hidden="true"></i>
              {{ label }}
            }
          </span>
          <app-language-selector />
          <button
            type="button"
            class="theme-toggle"
            (click)="theme.toggle()"
            [attr.aria-label]="
              theme.theme() === 'dark'
                ? i18n.t('header.theme.toLight')
                : i18n.t('header.theme.toDark')
            "
            [attr.title]="
              theme.theme() === 'dark'
                ? i18n.t('header.theme.light')
                : i18n.t('header.theme.dark')
            "
          >
            <i
              class="pi"
              [class.pi-sun]="theme.theme() === 'dark'"
              [class.pi-moon]="theme.theme() === 'light'"
              aria-hidden="true"
            ></i>
          </button>
        </div>
      </div>
    </header>

    <main id="main" class="container" role="main">
      <div class="split">
        <aside class="left">
          <app-filters-panel />
        </aside>
        <section class="right">
          <app-results-panel />
        </section>
      </div>
    </main>

    <footer class="gy-footer" role="contentinfo">
      <div class="gy-footer-inner">
        <div class="brand-mini">
          <span class="status-dot" aria-hidden="true"></span>
          <span class="brand-line">
            GreenYellow · <span class="muted">{{ i18n.t('header.brand.subtitle') }}</span>
          </span>
        </div>
        <div class="stack">
          <span class="stack-label">{{ i18n.t('footer.madeWith') }}</span>
          <span class="pill">Angular</span>
          <span class="pill">NestJS</span>
          <span class="pill">Postgres</span>
          <span class="pill">RabbitMQ</span>
          <span class="pill">Docker</span>
          <span class="pill">Chart.js</span>
          <span class="pill">i18n</span>
        </div>
        <div class="credit">
          <span>© {{ year }} · Caio Alves</span>
          <span class="rights">{{ i18n.t('footer.rights') }}</span>
        </div>
      </div>
    </footer>
  `,
  styles: [
    `
      /* Flex column + min-height garante que o footer fique sempre no
         fundo da pagina, mesmo em telas altas em que o conteudo nao
         enche a viewport. Com .container flex:1 abaixo, o main cresce
         e empurra o footer pra baixo. */
      :host {
        display: flex;
        flex-direction: column;
        min-height: 100vh;
      }
      .gy-header {
        background: var(--gy-surface);
        border-bottom: 1px solid var(--gy-border);
        position: sticky;
        top: 0;
        z-index: 20;
      }
      .gy-header-inner {
        max-width: 1240px;
        margin: 0 auto;
        padding: 1rem 1.25rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
      }
      .brand {
        display: inline-flex;
        align-items: center;
        gap: 0.85rem;
        text-decoration: none;
        color: inherit;
      }
      .brand-logo { display: block; height: 36px; width: auto; }
      :root[data-theme='dark'] .brand-logo {
        /* deixa a logo mais legivel no fundo escuro via leve filter */
        filter: brightness(1.15);
      }
      .brand-divider {
        display: inline-block;
        width: 1px;
        height: 24px;
        background: var(--gy-border);
      }
      .brand-sub {
        font-family: 'Nunito Sans', sans-serif;
        font-size: 0.78rem;
        color: var(--gy-text-soft);
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .header-right {
        display: flex;
        align-items: center;
        gap: 0.85rem;
      }
      .meta {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 0.82rem;
        color: var(--gy-text-soft);
      }
      .meta i { color: var(--gy-green); }
      .theme-toggle {
        width: 36px; height: 36px;
        display: grid; place-items: center;
        border-radius: 8px;
        border: 1px solid var(--gy-border);
        background: var(--gy-surface);
        color: var(--gy-text);
        cursor: pointer;
        transition: background 160ms, border-color 160ms, color 160ms;
      }
      .theme-toggle:hover {
        background: var(--gy-green-50);
        border-color: var(--gy-green);
        color: var(--gy-green-dark);
      }
      :root[data-theme='dark'] .theme-toggle:hover { color: var(--gy-green); }

      .container {
        max-width: 1240px;
        margin: 1.5rem auto 3.5rem;
        padding: 0 1.25rem;
        flex: 1; /* empurra o footer pro fundo em telas altas */
        width: 100%;
      }
      .split {
        display: grid;
        grid-template-columns: 360px 1fr;
        gap: 1.25rem;
        /* align-items: stretch (padrao do grid) faz as duas colunas
           terem a mesma altura — a mais alta dita o tamanho */
      }
      .left,
      .right {
        min-width: 0;
        display: flex;
      }
      .left > *,
      .right > * {
        flex: 1;
        min-width: 0;
      }

      @media (max-width: 900px) {
        .split { grid-template-columns: 1fr; }
        .brand-divider, .brand-sub { display: none; }
        .meta { display: none; }
      }

      @media (max-width: 520px) {
        .header-right { gap: 0.5rem; }
      }

      /* ========== Footer ========== */
      .gy-footer {
        background: var(--gy-surface);
        border-top: 1px solid var(--gy-border);
        padding: 1.1rem 0;
        margin-top: auto;
      }
      .gy-footer-inner {
        max-width: 1240px;
        margin: 0 auto;
        padding: 0 1.25rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        font-size: 0.8rem;
        color: var(--gy-text-soft);
        flex-wrap: wrap;
      }
      .brand-mini {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        font-weight: 700;
        color: var(--gy-text);
      }
      .brand-line .muted {
        color: var(--gy-text-soft);
        font-weight: 500;
      }
      .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--gy-green);
        box-shadow: 0 0 0 0 rgba(135, 188, 37, 0.5);
        animation: gy-pulse 2.2s ease-in-out infinite;
      }
      @keyframes gy-pulse {
        0%   { box-shadow: 0 0 0 0 rgba(135, 188, 37, 0.5); }
        50%  { box-shadow: 0 0 0 6px rgba(135, 188, 37, 0); }
        100% { box-shadow: 0 0 0 0 rgba(135, 188, 37, 0); }
      }
      .stack {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        flex-wrap: wrap;
        justify-content: center;
      }
      .stack-label {
        margin-right: 0.25rem;
        font-style: italic;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        padding: 0.18rem 0.55rem;
        border-radius: 999px;
        background: var(--gy-green-50);
        color: var(--gy-green-dark);
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.02em;
      }
      :root[data-theme='dark'] .pill {
        color: var(--gy-green);
      }
      .credit {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        line-height: 1.35;
        font-variant-numeric: tabular-nums;
      }
      .credit > span:first-child {
        color: var(--gy-text);
        font-weight: 600;
      }
      .credit .rights {
        font-size: 0.72rem;
        color: var(--gy-text-soft);
      }
      @media (max-width: 720px) {
        .gy-footer-inner { justify-content: center; text-align: center; }
        .stack { justify-content: center; }
        .credit { align-items: center; }
      }
    `,
  ],
})
export class AppComponent {
  readonly store = inject(MetricsStore);
  readonly theme = inject(ThemeService);
  readonly i18n = inject(I18nService);
  readonly year = new Date().getFullYear();

  readonly lastUploadLabel = computed(() => {
    const up = this.store.lastUpload();
    if (!up) return null;
    return this.i18n.t('header.lastUpload', { name: up.originalName });
  });
}
