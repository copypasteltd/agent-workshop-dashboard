export type BrowserAttachmentDraft = {
  id: string;
  file: File;
  label: string;
  sizeBytes: number;
  contentType: string | null;
};

function nextDraftId() {
  return `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function formatAttachmentSize(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return "0 B";
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  if (sizeBytes < 1024 * 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export async function pickBrowserAttachments(options?: {
  multiple?: boolean;
  accept?: string;
}): Promise<BrowserAttachmentDraft[]> {
  if (typeof document === "undefined") {
    throw new Error("Current runtime does not support local file selection.");
  }

  return await new Promise<BrowserAttachmentDraft[]>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = options?.multiple ?? true;
    input.accept = options?.accept ?? "";
    input.style.position = "fixed";
    input.style.left = "-9999px";

    const cleanup = () => {
      input.value = "";
      input.remove();
    };

    input.addEventListener(
      "change",
      () => {
        const files = Array.from(input.files ?? []);
        cleanup();
        resolve(
          files.map((file) => ({
            id: nextDraftId(),
            file,
            label: file.name,
            sizeBytes: file.size,
            contentType: file.type || null,
          }))
        );
      },
      { once: true }
    );

    document.body.appendChild(input);
    input.click();

    window.setTimeout(() => {
      if (!document.body.contains(input)) {
        return;
      }
      cleanup();
      resolve([]);
    }, 60_000);
  });
}
