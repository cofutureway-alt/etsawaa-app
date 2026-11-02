import type { SVGProps } from "react";

/**
 * Inline SVG icon set — stroke 2, 24x24, round caps (consistent per
 * ui-ux-pro-max icon rules). No emoji anywhere in the UI (AGENT.md #2).
 * Icons are decorative by default: pass `title` to make one meaningful.
 */

interface IconProps extends SVGProps<SVGSVGElement> {
  title?: string;
}

function Icon({ title, children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      width="1em"
      height="1em"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Icon>
);
export const UserIcon = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="8" r="4" /><path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" /></Icon>
);
export const CartIcon = (p: IconProps) => (
  <Icon {...p}><path d="M3 4h2l2.4 12.2A2 2 0 0 0 9.4 18h8.2a2 2 0 0 0 2-1.6L21 8H6" /><circle cx="10" cy="21" r="1" /><circle cx="18" cy="21" r="1" /></Icon>
);
export const HeartIcon = ({ filled, ...p }: IconProps & { filled?: boolean }) => (
  <Icon {...p} fill={filled ? "currentColor" : "none"}>
    <path d="M12 20s-7-4.3-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.7-9 9-9 9Z" />
  </Icon>
);
export const ScaleIcon = (p: IconProps) => (
  <Icon {...p}><path d="M12 4v16M8 20h8" /><path d="M6 8h12" /><path d="m6 8-3 6a3 3 0 0 0 6 0L6 8ZM18 8l-3 6a3 3 0 0 0 6 0l-3-6Z" /></Icon>
);
export const FilterIcon = (p: IconProps) => (
  <Icon {...p}><path d="M4 6h16M7 12h10M10 18h4" /></Icon>
);
export const MinusIcon = (p: IconProps) => <Icon {...p}><path d="M5 12h14" /></Icon>;
export const BellIcon = (p: IconProps) => (
  <Icon {...p}><path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6" /><path d="M10 19a2 2 0 0 0 4 0" /></Icon>
);
export const GlobeIcon = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 4 5.6 4 9s-1.5 6.4-4 9c-2.5-2.6-4-5.6-4-9s1.5-6.4 4-9Z" /></Icon>
);
export const CheckIcon = (p: IconProps) => <Icon {...p}><path d="m4 12 5 5L20 6" /></Icon>;
export const XIcon = (p: IconProps) => <Icon {...p}><path d="M6 6l12 12M18 6 6 18" /></Icon>;
export const AlertIcon = (p: IconProps) => (
  <Icon {...p}><path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v4m0 3v.5" /></Icon>
);
export const InfoIcon = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5m0-8v.5" /></Icon>
);
export const ChevronDownIcon = (p: IconProps) => <Icon {...p}><path d="m6 9 6 6 6-6" /></Icon>;
export const ChevronRightIcon = (p: IconProps) => <Icon {...p}><path d="m9 6 6 6-6 6" /></Icon>;
export const ChevronLeftIcon = (p: IconProps) => <Icon {...p}><path d="m15 6-6 6 6 6" /></Icon>;
export const MenuIcon = (p: IconProps) => <Icon {...p}><path d="M4 6h16M4 12h16M4 18h16" /></Icon>;
export const UploadIcon = (p: IconProps) => (
  <Icon {...p}><path d="M12 16V4m0 0 -4 4m4-4 4 4" /><path d="M4 20h16" /></Icon>
);
export const StarIcon = (p: IconProps) => (
  <Icon {...p} fill="currentColor" stroke="none"><path d="M12 2.5 14.9 8.6l6.6.8-4.9 4.5 1.3 6.6L12 17.2l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8L12 2.5Z" /></Icon>
);
export const StoreIcon = (p: IconProps) => (
  <Icon {...p}><path d="M4 9 5.5 4h13L20 9" /><path d="M4 9a3 3 0 0 0 3 3 3 3 0 0 0 5 0 3 3 0 0 0 5 0 3 3 0 0 0 3-3" /><path d="M5 12v8h14v-8" /><path d="M9 20v-5h6v5" /></Icon>
);
export const MailIcon = (p: IconProps) => (
  <Icon {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></Icon>
);
export const EyeIcon = (p: IconProps) => (
  <Icon {...p}><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" /><circle cx="12" cy="12" r="3" /></Icon>
);
export const EyeOffIcon = (p: IconProps) => (
  <Icon {...p}><path d="M3 3l18 18" /><path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3 3.9M6.6 6.6A16.9 16.9 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 4.4-1" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></Icon>
);
export const SpinnerIcon = (p: IconProps) => (
  <Icon {...p} className={`animate-spin ${p.className ?? ""}`}><path d="M12 3a9 9 0 1 0 9 9" /></Icon>
);
export const ShieldIcon = (p: IconProps) => (
  <Icon {...p}><path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></Icon>
);
export const FileIcon = (p: IconProps) => (
  <Icon {...p}><path d="M6 3h8l4 4v14H6V3Z" /><path d="M14 3v4h4" /></Icon>
);
export const PackageIcon = (p: IconProps) => (
  <Icon {...p}><path d="M12 3 3 7.5v9L12 21l9-4.5v-9L12 3Z" /><path d="M3 7.5 12 12l9-4.5" /><path d="M12 12v9" /></Icon>
);
export const TruckIcon = (p: IconProps) => (
  <Icon {...p}><path d="M3 7h11v9H3V7Z" /><path d="M14 10h4l3 3v3h-7v-6Z" /><circle cx="7" cy="18.5" r="1.6" /><circle cx="17.5" cy="18.5" r="1.6" /></Icon>
);
export const TagIcon = (p: IconProps) => (
  <Icon {...p}><path d="M20.6 12.4 12.4 20.6a2 2 0 0 1-2.8 0l-6.2-6.2a2 2 0 0 1 0-2.8L11.6 3.4a2 2 0 0 1 1.4-.6h5.6a2 2 0 0 1 2 2v5.6a2 2 0 0 1-.6 1.4Z" /><circle cx="16.5" cy="7.5" r="1.2" fill="currentColor" stroke="none" /></Icon>
);
export const CreditCardIcon = (p: IconProps) => (
  <Icon {...p}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /><path d="M6 15h4" /></Icon>
);
export const CashIcon = (p: IconProps) => (
  <Icon {...p}><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></Icon>
);
export const RotateIcon = (p: IconProps) => (
  <Icon {...p}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></Icon>
);
export const LogoutIcon = (p: IconProps) => (
  <Icon {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></Icon>
);
export const SettingsIcon = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></Icon>
);
export const UsersIcon = (p: IconProps) => (
  <Icon {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.9-3.2 3.4-4.8 6.5-4.8s5.6 1.6 6.5 4.8" /><path d="M17 5.2a3.4 3.4 0 0 1 0 6.6" /><path d="M18.5 20c-.3-2-1.2-3.5-2.5-4.4" /></Icon>
);
export const ChartIcon = (p: IconProps) => (
  <Icon {...p}><path d="M3 3v18h18" /><path d="M7 15v3M12 9v9M17 5v13" /></Icon>
);
export const ListIcon = (p: IconProps) => (
  <Icon {...p}><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></Icon>
);
export const PanelLeftIcon = (p: IconProps) => (
  <Icon {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></Icon>
);

/* Storefront category glyphs — the reference "cats-panel" icon set. */
export const GridIcon = (p: IconProps) => (
  <Icon {...p}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></Icon>
);
export const ReceiptIcon = (p: IconProps) => (
  <Icon {...p}><path d="M5 3h14v18l-2.5-2-2.5 2-2.5-2L9 21l-2-2-2 1V3Z" /><path d="M9 8h6M9 12h6" /></Icon>
);

/* Phase 02 — media library icons */
export const FolderIcon = (p: IconProps) => (
  <Icon {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /></Icon>
);
export const FolderPlusIcon = (p: IconProps) => (
  <Icon {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /><path d="M12 10v6M9 13h6" /></Icon>
);
export const TrashIcon = (p: IconProps) => (
  <Icon {...p}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></Icon>
);
export const PencilIcon = (p: IconProps) => (
  <Icon {...p}><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" /><path d="M13.5 6.5l3 3" /></Icon>
);
export const MoveIcon = (p: IconProps) => (
  <Icon {...p}><path d="M5 9c-1.5 1.5-1.5 4.5 0 6M19 9c1.5 1.5 1.5 4.5 0 6M9 5c1.5-1.5 4.5-1.5 6 0M9 19c1.5 1.5 4.5 1.5 6 0" /><circle cx="12" cy="12" r="2.5" /></Icon>
);
export const CopyIcon = (p: IconProps) => (
  <Icon {...p}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></Icon>
);
export const VideoIcon = (p: IconProps) => (
  <Icon {...p}><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3" /></Icon>
);
export const PlusIcon = (p: IconProps) => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>;
/** Map pin (H-23 saved-location badge on address cards). */
export const PinIcon = (p: IconProps) => (
  <Icon {...p}><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="3" /></Icon>
);
