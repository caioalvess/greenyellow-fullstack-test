import {
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { I18nService } from './i18n.service';
import { Locale } from './translations';

/**
 * Botao compacto no header pra trocar idioma.
 *
 * UX: click abre um menu com as 4 opcoes; click fora / Escape fecha.
 * Visualmente pareado com o theme-toggle (mesma altura/borda) pra ficar
 * no mesmo grupo de acoes globais.
 */
@Component({
  selector: 'app-language-selector',
  standalone: true,
  template: `
    <button
      type="button"
      class="lang-btn"
      [attr.aria-label]="i18n.t('header.lang.aria')"
      [attr.aria-haspopup]="true"
      [attr.aria-expanded]="open()"
      [attr.title]="currentLabel()"
      (click)="toggle($event)"
    >
      <span class="flag" aria-hidden="true">{{ currentFlag() }}</span>
      <i class="pi pi-angle-down chev" aria-hidden="true"></i>
    </button>

    @if (open()) {
      <div class="menu" role="menu">
        @for (loc of i18n.available; track loc.code) {
          <button
            type="button"
            role="menuitem"
            class="menu-item"
            [class.active]="i18n.locale() === loc.code"
            (click)="pick(loc.code)"
          >
            <span class="menu-flag" aria-hidden="true">{{ loc.flag }}</span>
            <span class="menu-label">{{ loc.label }}</span>
            @if (i18n.locale() === loc.code) {
              <i class="pi pi-check menu-check" aria-hidden="true"></i>
            }
          </button>
        }
      </div>
    }
  `,
  styles: [
    `
      :host { position: relative; display: inline-block; }
      .lang-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        height: 36px;
        padding: 0 0.55rem 0 0.7rem;
        border-radius: 8px;
        border: 1px solid var(--gy-border);
        background: var(--gy-surface);
        color: var(--gy-text);
        cursor: pointer;
        font: inherit;
        font-weight: 700;
        font-size: 0.78rem;
        letter-spacing: 0.04em;
        transition: background 160ms, border-color 160ms, color 160ms;
      }
      .lang-btn:hover {
        background: var(--gy-green-50);
        border-color: var(--gy-green);
        color: var(--gy-green-dark);
      }
      :root[data-theme='dark'] .lang-btn:hover { color: var(--gy-green); }
      .lang-btn .flag { font-size: 1.05rem; line-height: 1; }
      .lang-btn .chev { font-size: 0.7rem; opacity: 0.75; }

      .menu {
        position: absolute;
        top: calc(100% + 0.4rem);
        right: 0;
        min-width: 170px;
        background: var(--gy-surface);
        border: 1px solid var(--gy-border);
        border-radius: 10px;
        box-shadow: var(--gy-shadow-lg);
        padding: 0.3rem;
        z-index: 30;
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
        animation: gy-lang-in 140ms cubic-bezier(0.4, 0, 0.2, 1);
      }
      @keyframes gy-lang-in {
        from { opacity: 0; transform: translateY(-4px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      .menu-item {
        display: flex;
        align-items: center;
        gap: 0.55rem;
        background: transparent;
        border: 0;
        padding: 0.45rem 0.6rem;
        border-radius: 7px;
        cursor: pointer;
        font: inherit;
        color: var(--gy-text);
        text-align: left;
        transition: background 120ms ease;
      }
      .menu-item:hover { background: var(--gy-green-50); }
      :root[data-theme='dark'] .menu-item:hover { background: var(--gy-surface-2); }
      .menu-item.active {
        color: var(--gy-green-dark);
        font-weight: 700;
      }
      :root[data-theme='dark'] .menu-item.active { color: var(--gy-green); }
      .menu-flag {
        font-size: 1.05rem;
        line-height: 1;
        display: inline-block;
        width: 1.4em;
        text-align: center;
      }
      .menu-label { flex: 1; font-size: 0.85rem; }
      .menu-check { font-size: 0.75rem; color: var(--gy-green); }
    `,
  ],
})
export class LanguageSelectorComponent {
  readonly i18n = inject(I18nService);
  private readonly host = inject(ElementRef<HTMLElement>);
  readonly open = signal(false);

  readonly currentFlag = computed(
    () => this.i18n.available.find((l) => l.code === this.i18n.locale())?.flag ?? '',
  );
  readonly currentLabel = computed(
    () => this.i18n.available.find((l) => l.code === this.i18n.locale())?.label ?? '',
  );

  toggle(ev: MouseEvent): void {
    ev.stopPropagation();
    this.open.update((v) => !v);
  }

  pick(code: Locale): void {
    this.i18n.setLocale(code);
    this.open.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocClick(ev: MouseEvent): void {
    if (!this.open()) return;
    const target = ev.target as Node;
    if (!this.host.nativeElement.contains(target)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open()) this.open.set(false);
  }
}
