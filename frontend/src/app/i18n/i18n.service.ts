import { DOCUMENT } from '@angular/common';
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { LOCALES, Locale, TRANSLATIONS } from './translations';

const STORAGE_KEY = 'gy-locale';

/**
 * Servico de i18n baseado em signals.
 *
 * - Escolha inicial: localStorage -> navigator.language -> 'pt'.
 * - Persiste via effect igual ao ThemeService.
 * - Atualiza <html lang="..."> pra acessibilidade e Intl consistente.
 * - `t(key, params?)` le o signal `locale()` por dentro, entao chamadas em
 *   template sao rastreadas: trocar o idioma re-renderiza automaticamente.
 * - `bcp47()` exposto pra formatacoes com Intl (datas, numeros) respeitarem
 *   o idioma sem cada componente precisar traduzir o code.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly doc = inject(DOCUMENT);
  readonly locale = signal<Locale>(this.readInitial());
  readonly available = LOCALES;

  readonly bcp47 = computed(
    () => LOCALES.find((l) => l.code === this.locale())?.bcp47 ?? 'pt-BR',
  );

  constructor() {
    effect(() => {
      const code = this.locale();
      const bcp47 = LOCALES.find((l) => l.code === code)?.bcp47 ?? code;
      this.doc.documentElement.setAttribute('lang', bcp47);
      try {
        localStorage.setItem(STORAGE_KEY, code);
      } catch {
        // localStorage pode estar bloqueado — segue
      }
    });
  }

  setLocale(code: Locale): void {
    this.locale.set(code);
  }

  /**
   * Busca a chave no dicionario do idioma atual; cai pro pt como fallback
   * pra nunca cuspir a string bruta (key) na UI caso algum idioma esteja
   * incompleto. Se a chave nao existir nem em pt, devolve a propria chave
   * (comportamento de "missing key" visivel em dev).
   */
  t(key: string, params?: Record<string, string | number>): string {
    const dict = TRANSLATIONS[this.locale()];
    const raw = dict[key] ?? TRANSLATIONS.pt[key] ?? key;
    if (!params) return raw;
    return raw.replace(/\{(\w+)\}/g, (_, k: string) =>
      params[k] !== undefined ? String(params[k]) : `{${k}}`,
    );
  }

  private readInitial(): Locale {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && LOCALES.some((l) => l.code === saved)) return saved as Locale;
    } catch {
      // ignore
    }
    const nav = (typeof navigator !== 'undefined' ? navigator.language : '') || '';
    const prefix = nav.slice(0, 2).toLowerCase();
    if (LOCALES.some((l) => l.code === prefix)) return prefix as Locale;
    return 'pt';
  }
}
