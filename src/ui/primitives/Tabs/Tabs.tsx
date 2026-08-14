"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import styles from "./Tabs.module.css";

export interface TabItem {
  value: string;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}

export function Tabs({ items, value, defaultValue, onValueChange }: TabsProps) {
  const [internalValue, setInternalValue] = useState(defaultValue ?? items[0]?.value);
  const active = value ?? internalValue;

  function select(next: string) {
    const target = items.find((item) => item.value === next);
    if (!target || target.disabled) return;
    setInternalValue(next);
    onValueChange?.(next);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const enabledItems = items.filter((item) => !item.disabled);
    const index = enabledItems.findIndex((item) => item.value === active);
    if (index === -1) return;
    if (event.key === "ArrowRight") {
      select(enabledItems[(index + 1) % enabledItems.length]!.value);
    } else if (event.key === "ArrowLeft") {
      select(enabledItems[(index - 1 + enabledItems.length) % enabledItems.length]!.value);
    }
  }

  const activeItem = items.find((item) => item.value === active);

  return (
    <div>
      <div className={styles.list} role="tablist" onKeyDown={handleKeyDown}>
        {items.map((item) => (
          <button
            key={item.value}
            role="tab"
            type="button"
            aria-selected={item.value === active}
            aria-controls={`panel-${item.value}`}
            id={`tab-${item.value}`}
            disabled={item.disabled}
            tabIndex={item.value === active ? 0 : -1}
            className={[styles.trigger, item.value === active && styles.triggerActive].filter(Boolean).join(" ")}
            onClick={() => select(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className={styles.panel} role="tabpanel" id={`panel-${activeItem?.value ?? "empty"}`} aria-labelledby={`tab-${activeItem?.value ?? "empty"}`}>
        {activeItem?.content}
      </div>
    </div>
  );
}
