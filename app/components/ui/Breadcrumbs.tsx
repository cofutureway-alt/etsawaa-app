import { Fragment, type ReactNode } from "react";
import { ChevronRightIcon } from "./icons";

export interface Crumb {
  label: ReactNode;
  href?: string;
}

/**
 * Breadcrumb trail: `nav > ol`, current page marked with aria-current.
 * The chevron points with the reading direction (mirrored by the browser
 * via dir attribute since the SVG uses logical coordinates).
 */
export function Breadcrumbs({ label, items }: { label: string; items: Crumb[] }) {
  return (
    <nav aria-label={label}>
      <ol className="flex flex-wrap items-center gap-1.5 text-sm">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <Fragment key={index}>
              <li>
                {item.href && !isLast ? (
                  <a href={item.href} className="text-text-muted transition-colors duration-150 hover:text-action">
                    {item.label}
                  </a>
                ) : (
                  <span aria-current={isLast ? "page" : undefined} className="font-bold text-text">
                    {item.label}
                  </span>
                )}
              </li>
              {!isLast ? (
                <li aria-hidden="true" className="text-text-faint rtl:rotate-180">
                  <ChevronRightIcon />
                </li>
              ) : null}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
