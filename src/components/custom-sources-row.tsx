import { Row } from "./row";
import { SourceFolderCard } from "./source-folder-card";
import type { SourceRow } from "@/lib/custom-sources";

/** A row of collection folders, sized like Harbor's own rows (Collections). */
export function CustomSourcesRow({
  sourceRow,
  editMode,
  onEditFolderImages,
  onViewAll,
}: {
  sourceRow: SourceRow;
  editMode?: boolean;
  onEditFolderImages?: (sourceId: string, folderId: string, cover: string, gif: string) => void;
  onViewAll?: () => void;
}) {
  if (!sourceRow.folders || sourceRow.folders.length === 0) return null;

  const first = sourceRow.folders[0];
  const isLogo = sourceRow.layout === "logo" || !!first?.logo;
  const isPoster = !isLogo && first?.tileShape === "POSTER";

  return (
    <Row
      title={sourceRow.title}
      min={isPoster ? 180 : isLogo ? 260 : 320}
      shape={isPoster ? "portrait" : "landscape"}
      arrowsAlways
      scrollKey={`home:source:${sourceRow.id}`}
      onViewAll={onViewAll}
    >
      {sourceRow.folders.map((folder, index) => (
        <SourceFolderCard
          key={`${folder.id}-${index}`}
          folder={folder}
          editMode={editMode}
          sourceId={sourceRow.id}
          onEditFolderImages={onEditFolderImages}
        />
      ))}
    </Row>
  );
}
