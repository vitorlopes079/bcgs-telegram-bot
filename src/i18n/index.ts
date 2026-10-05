import en from './en';

type LeafKeys<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${LeafKeys<T[K]>}`;
}[keyof T & string];

export type MessageKey = LeafKeys<typeof en>;

type Catalog = { [key: string]: string | Catalog };
const catalogs = { en } satisfies Record<string, Catalog>;

export type Locale = keyof typeof catalogs;

export function t(
  key: MessageKey,
  params: Record<string, string | number> = {},
  locale: Locale = 'en',
): string {
  const read = (catalog: Catalog): string | undefined => {
    let value: string | Catalog = catalog;
    for (const part of key.split('.')) {
      if (typeof value === 'string' || !(part in value)) return undefined;
      value = value[part];
    }
    return typeof value === 'string' ? value : undefined;
  };

  const template = read(catalogs[locale]) ?? read(catalogs.en) ?? key;
  return template.replace(/\{([^{}]+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder,
  );
}

export function getLocale(_ctx: unknown): Locale {
  // ctx.from?.language_code or a saved user preference will plug in here later.
  return 'en';
}
