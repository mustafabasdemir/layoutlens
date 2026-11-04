import { useEffect, useRef } from "react";
import { FileUp, FolderOpen } from "lucide-react";
import { navigate } from "../../app/router";
import { useReports } from "../../data/report-store";
import { Button } from "../../ui/primitives";

/**
 * Opens a CLI report bundle from disk. Files are read locally by the browser and
 * never uploaded anywhere.
 */
export function ReportPicker({
  primary = false,
  goToReports = true,
  compact = false,
}: {
  primary?: boolean;
  goToReports?: boolean;
  compact?: boolean;
}) {
  const { openFiles, loading } = useReports();
  const folderRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    folderRef.current?.setAttribute("webkitdirectory", "");
    folderRef.current?.setAttribute("directory", "");
  }, []);

  async function onChange(input: HTMLInputElement | null) {
    if (!input?.files) return;
    const files = [...input.files];
    input.value = "";
    const loaded = await openFiles(files);
    if (loaded && goToReports) navigate("reports");
  }

  return (
    <div className="picker">
      <input
        ref={folderRef}
        type="file"
        multiple
        className="visually-hidden"
        data-testid="report-folder-input"
        aria-label="Select report folder"
        tabIndex={-1}
        onChange={(e) => void onChange(e.currentTarget)}
      />
      <input
        ref={filesRef}
        type="file"
        multiple
        accept=".json,.png,application/json,image/png"
        className="visually-hidden"
        data-testid="report-files-input"
        aria-label="Select report files"
        tabIndex={-1}
        onChange={(e) => void onChange(e.currentTarget)}
      />
      <Button
        variant={primary ? "primary" : "secondary"}
        icon={<FolderOpen size={15} />}
        onClick={() => folderRef.current?.click()}
        disabled={loading}
      >
        {loading ? "Opening…" : "Open report folder"}
      </Button>
      {!compact ? (
        <Button variant="ghost" icon={<FileUp size={15} />} onClick={() => filesRef.current?.click()} disabled={loading}>
          Choose files
        </Button>
      ) : null}
    </div>
  );
}
