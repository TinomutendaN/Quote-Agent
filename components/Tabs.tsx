"use client";

import { Icon, type IconName } from "./Icon";

export type TabItem<K extends string> = { key: K; label: string; icon?: IconName };

/**
 * Page tabs: uppercase labels with icons and a navy underline on the active tab.
 * Sits on a full-width bottom border.
 */
export function PageTabs<K extends string>({
  tabs,
  active,
  onChange,
  label,
}: {
  tabs: TabItem<K>[];
  active: K;
  onChange: (key: K) => void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line">
      <div role="tablist" aria-label={label} className="flex flex-wrap gap-3.5">
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onChange(t.key)}
              className={`-mb-px inline-flex min-h-11 cursor-pointer items-center gap-2 border-0 border-b-2 bg-transparent px-2 text-[13px] font-semibold tracking-[0.03em] ${
                on ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {t.icon && <Icon name={t.icon} size={18} />}
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Small tabs inside a card (e.g. FILES / SUPPLIER HISTORY). */
export function CardTabs<K extends string>({
  tabs,
  active,
  onChange,
  label,
}: {
  tabs: TabItem<K>[];
  active: K;
  onChange: (key: K) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-[18px]">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className={`cursor-pointer border-0 border-b-2 bg-transparent px-0 py-2 text-xs font-semibold tracking-[0.03em] ${
              on ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
