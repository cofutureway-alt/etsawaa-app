/**
 * Media UI barrel — the public surface of the shared media components.
 *
 * Implementation lives in focused modules next to this file:
 *   MediaImage.tsx         public media <img> (M-09)
 *   MediaPickerDialog.tsx  picker modal around MediaLibraryCore
 *   MediaLibraryCore.tsx   full library component + MediaLibraryProps
 *   media-shared.tsx       toolbar + pagination
 *   media-folder-tree.tsx  folder helpers, tree view, desktop aside
 *   media-content.tsx      content grid (loading / empty / file tiles)
 *   useMediaUpload.tsx     upload queue hook + progress list
 *   media-dialogs.tsx      rename/move forms + dialog cluster
 *
 * Re-exported unchanged so `~/features/media/components/media-ui` import
 * paths elsewhere keep working.
 */
export { MediaImage } from "./MediaImage";
export { MediaLibraryCore, type MediaLibraryProps } from "./MediaLibraryCore";
export { MediaPickerDialog } from "./MediaPickerDialog";
