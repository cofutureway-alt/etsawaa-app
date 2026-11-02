import { useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { UploadIcon } from "./icons";
import { AlertIcon } from "./icons";

export interface FileUploadProps {
  label: ReactNode;
  accept?: string;
  /** Validate mime prefixes, e.g. ["image/", "application/pdf"] */
  allowedPrefixes?: string[];
  maxSizeBytes?: number;
  onPick: (file: File) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}

/**
 * FileUpload primitive with drag & drop + pre-upload validation
 * (type + size checked before anything "uploads" — real storage wiring is
 * phase 02). Announces errors inline; the dropzone is keyboard-reachable
 * via the hidden file input.
 */
export function FileUpload({
  label,
  accept,
  allowedPrefixes = ["image/"],
  maxSizeBytes = 5 * 1024 * 1024,
  onPick,
  onError,
  disabled,
}: FileUploadProps) {
  const { t } = useTranslation();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  function validate(file: File): boolean {
    const mimeOk = allowedPrefixes.some((prefix) => file.type.startsWith(prefix));
    if (!mimeOk) {
      onError(t("ui.fileupload.invalidType"));
      return false;
    }
    if (file.size > maxSizeBytes) {
      onError(`${file.name}: ${(file.size / 1024 / 1024).toFixed(1)} MB`);
      return false;
    }
    return true;
  }

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (!validate(file)) {
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setPicked(file.name);
    onPick(file);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-[13px] font-bold text-text">
        {label}
      </label>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-describedby={picked ? undefined : undefined}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(event) => {
          if (!disabled && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          if (!disabled) handleFiles(event.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-l border-2 border-dashed px-6 py-8 text-center transition-colors duration-150 ${
          dragOver ? "border-primary bg-surface-tint" : "border-border-strong bg-surface-alt hover:bg-surface-tint"
        } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
      >
        <UploadIcon aria-hidden="true" className="text-text-muted" width={22} height={22} />
        <span className="text-[13px] text-text-muted">{t("ui.fileupload.hint")}</span>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={accept}
          className="sr-only"
          disabled={disabled}
          onChange={(event) => handleFiles(event.target.files)}
        />
      </div>
      {picked ? (
        <p className="flex items-center gap-1.5 text-xs text-success-strong">
          {t("ui.fileupload.picked", { name: picked, size: "" })}
        </p>
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-text-faint">
          <AlertIcon aria-hidden="true" />
          {allowedPrefixes.join(", ")}
        </p>
      )}
    </div>
  );
}
