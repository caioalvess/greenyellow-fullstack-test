import { Component, inject } from '@angular/core';
import { ToastModule } from 'primeng/toast';
import { FiltersPanelComponent } from './filters-panel/filters-panel.component';
import { ResultsPanelComponent } from './results-panel/results-panel.component';
import { I18nService } from './i18n/i18n.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ToastModule, FiltersPanelComponent, ResultsPanelComponent],
  template: `
    <p-toast position="top-right" />

    <div class="frame">
      <aside class="sidebar" role="complementary">
        <a
          class="brand"
          href="/"
          [attr.aria-label]="i18n.t('header.brand.aria')"
        >
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

        <app-filters-panel />

        <div class="signature">
          <div class="sig-info">
            <div class="sig-name">Caio Alves</div>
            <div class="sig-meta">full-stack · {{ year }}</div>
          </div>
          <div class="sig-links">
            <a
              class="sig-link"
              href="https://github.com/caioalvess"
              target="_blank"
              rel="noopener"
              aria-label="GitHub"
              title="GitHub"
            >
              <i class="pi pi-github" aria-hidden="true"></i>
            </a>
            <a
              class="sig-link"
              href="https://www.linkedin.com/in/caio-alvess/"
              target="_blank"
              rel="noopener"
              aria-label="LinkedIn"
              title="LinkedIn"
            >
              <i class="pi pi-linkedin" aria-hidden="true"></i>
            </a>
          </div>
        </div>
      </aside>

      <main id="main" class="main" role="main">
        <app-results-panel />
      </main>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        min-height: 100vh;
      }

      /* Frame: fundo com gradientes radiais suaves (verde+amarelo da
         marca) por cima de um tom neutro. Preenche a viewport inteira e
         cresce com o conteudo. */
      .frame {
        width: 100%;
        min-height: 100vh;
        padding: 12px;
        display: grid;
        grid-template-columns: 340px 1fr;
        gap: 12px;
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.75), rgba(255, 255, 255, 0.6)),
          radial-gradient(circle at 30% 20%, rgba(135, 188, 37, 0.18), transparent 45%),
          radial-gradient(circle at 70% 80%, rgba(252, 204, 29, 0.15), transparent 45%),
          var(--gy-bg);
      }
      /* Override dark mode esta em styles.scss (global) pra escapar
         da view encapsulation do Angular e garantir specificity. */

      /* Sidebar: card branco arredondado, conteúdo em coluna.
         O FiltersPanel fica no meio; signature gruda no fim via
         margin-top:auto. Brand no topo. */
      .sidebar {
        background: var(--gy-surface);
        border: 1px solid var(--gy-border);
        border-radius: 14px;
        padding: 1rem 1.1rem;
        display: flex;
        flex-direction: column;
        box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
        min-width: 0;
      }
      .sidebar > app-filters-panel {
        display: block;
        flex: 1;
        min-height: 0;
      }

      .brand {
        display: flex;
        align-items: center;
        gap: 0.55rem;
        padding: 0.2rem 0.1rem;
        margin-bottom: 0.6rem;
        text-decoration: none;
        color: inherit;
      }
      .brand-logo {
        display: block;
        height: 34px;
        width: auto;
      }
      :root[data-theme='dark'] .brand-logo {
        filter: brightness(1.15);
      }
      .brand-divider {
        width: 1px;
        height: 22px;
        background: var(--gy-border);
      }
      .brand-sub {
        font-family: 'Nunito Sans', sans-serif;
        font-weight: 600;
        font-size: 0.68rem;
        color: var(--gy-text-soft);
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }

      /* Assinatura no rodape. margin-top: auto gruda no fim via flex,
         enquanto o margin-top concreto fornece o respiro minimo sobre
         os botoes de acao quando nao ha espaco sobrando. */
      .signature {
        margin-top: 2rem;
        padding-top: 1.25rem;
        border-top: 1px solid var(--gy-border-soft);
        display: flex;
        align-items: center;
        gap: 0.6rem;
      }
      /* Empurra pro fim quando a sidebar e' mais alta que o conteudo. */
      .sidebar > app-filters-panel {
        margin-bottom: auto;
      }
      .sig-info {
        flex: 1;
        min-width: 0;
      }
      .sig-name {
        font-weight: 700;
        font-size: 0.84rem;
        color: var(--gy-text);
        line-height: 1.1;
      }
      .sig-meta {
        font-family: 'JetBrains Mono', 'Nunito Sans', monospace;
        font-size: 0.66rem;
        color: var(--gy-text-soft);
        margin-top: 0.15rem;
        letter-spacing: 0.03em;
      }
      .sig-links {
        display: inline-flex;
        gap: 0.15rem;
      }
      .sig-link {
        width: 30px;
        height: 30px;
        border-radius: 6px;
        color: var(--gy-green);
        display: grid;
        place-items: center;
        text-decoration: none;
        transition: background 140ms ease, color 140ms ease;
      }
      .sig-link:hover {
        color: var(--gy-green-dark);
        background: var(--gy-green-50);
      }
      :root[data-theme='dark'] .sig-link:hover {
        color: var(--gy-green);
      }
      .sig-link i {
        font-size: 0.95rem;
      }

      .main {
        min-width: 0;
        display: flex;
      }
      .main > app-results-panel {
        display: flex;
        flex: 1;
        min-width: 0;
      }

      /* Stack vertical em telas estreitas — signature vai pro fim da
         coluna, FiltersPanel ocupa o meio. */
      @media (max-width: 900px) {
        .frame {
          grid-template-columns: 1fr;
        }
        .brand-divider,
        .brand-sub {
          display: none;
        }
      }
    `,
  ],
})
export class AppComponent {
  readonly i18n = inject(I18nService);
  readonly year = new Date().getFullYear();
}
