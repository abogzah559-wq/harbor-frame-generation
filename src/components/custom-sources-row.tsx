import { Row } from "./row";
import { SourceFolderCard } from "./source-folder-card";
import type { SourceRow } from "@/lib/custom-sources";

export function CustomSourcesRow({
  sourceRow,
  editMode,
  onEditFolderImages,
}: {
  sourceRow: SourceRow;
  editMode?: boolean;
  onEditFolderImages?: (sourceId: string, folderId: string, cover: string, gif: string) => void;
}) {
  if (!sourceRow.folders || sourceRow.folders.length === 0) return null;

  const shape = sourceRow.folders[0]?.tileShape;
  const isPoster = shape === "POSTER";
  const width = isPoster ? 160 : shape === "SQUARE" ? 210 : 320;

  return (
    <Row
      title={sourceRow.title}
      min={width}
      shape={isPoster ? "portrait" : "landscape"}
      arrowsAlways
      scrollKey={`home:source:${sourceRow.id}`}
    >
      {sourceRow.folders.map((folder, index) => (
        <div key={`${folder.id}-${index}`} style={{ width }}>
          <SourceFolderCard
            folder={folder}
            editMode={editMode}
            sourceId={sourceRow.id}
            onEditFolderImages={onEditFolderImages}
            showAllTab={!!sourceRow.showAllTab}
          />
        </div>
      ))}
    </Row>
  );
}
