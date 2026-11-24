/**
 * MediaPickerDialog — modal wrapper that opens MediaLibraryCore in picker
 * mode and closes on confirm/cancel.
 *
 * Extracted from media-ui.tsx (barrel re-exports it; import paths unchanged).
 */
import { Dialog } from "~/components/ui/Overlay";
import type { MediaKind, MediaSettings } from "~/lib/media.shared";
import type { MediaFileRow } from "../api";
import { MediaLibraryCore } from "./MediaLibraryCore";

/* --------------------------------------------------------- MediaPickerDialog */
export function MediaPickerDialog({ open, onClose, title, settings, uid, supabaseUrl, mode, kinds, onConfirm }: {
  open: boolean;
  onClose: () => void;
  title: string;
  settings: MediaSettings;
  uid: string;
  supabaseUrl: string;
  mode: "single" | "multi";
  kinds?: MediaKind[];
  onConfirm: (files: MediaFileRow[]) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} size="picker">
      <MediaLibraryCore
        settings={settings}
        uid={uid}
        supabaseUrl={supabaseUrl}
        select={{ mode, kinds }}
        onConfirm={(files) => { onConfirm(files); onClose(); }}
        onCancel={onClose}
      />
    </Dialog>
  );
}
