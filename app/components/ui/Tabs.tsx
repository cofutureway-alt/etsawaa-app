import { useId, useState, type ReactNode } from "react";

export interface TabItem {
  id: string;
  label: ReactNode;
  content: ReactNode;
}

/** ARIA tabs with ArrowLeft/ArrowRight (direction-aware) + Home/End. */
export function Tabs({ items }: { items: TabItem[] }) {
  const [active, setActive] = useState(items[0]?.id ?? "");
  const baseId = useId();

  function onKeyDown(event: React.KeyboardEvent) {
    const index = items.findIndex((item) => item.id === active);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % items.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;
    event.preventDefault();
    setActive(items[next]?.id ?? "");
    document.getElementById(`${baseId}-tab-${items[next]?.id}`)?.focus();
  }

  return (
    <div>
      <div role="tablist" aria-orientation="horizontal" onKeyDown={onKeyDown} className="flex gap-1 border-b border-border">
        {items.map((item) => {
          const selected = item.id === active;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(item.id)}
              className={`cursor-pointer rounded-t-m border-b-2 px-4 py-2.5 text-[13px] font-bold transition-colors duration-150 ${
                selected
                  ? "border-action text-action"
                  : "border-transparent text-text-muted hover:bg-surface-tint hover:text-text"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          role="tabpanel"
          id={`${baseId}-panel-${item.id}`}
          aria-labelledby={`${baseId}-tab-${item.id}`}
          hidden={item.id !== active}
          className="py-4 text-sm text-text"
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}
