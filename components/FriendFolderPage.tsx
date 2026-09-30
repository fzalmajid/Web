"use client";

export type FriendFolderNode = {
  id: string;
  parent_id: string | null;
  title: string;
  emoji?: string | null;
  card_color?: string | null;
};

export type FriendReferenceEntry = {
  id: string;
  node_id: string;
  title: string;
  category?: string | null;
  source_file_id?: string | null;
};

export type FriendReferenceFile = {
  id: string;
  node_id: string;
  file_name: string;
  mime_type: string;
  source_kind?: string | null;
  processing_status?: string | null;
};

export type FriendReferenceRecording = {
  id: string;
  node_id: string | null;
  title: string;
};

export default function FriendFolderPage({
  current,
  children,
  entries,
  files,
  recordings,
  onOpen,
  embedded = false,
}: {
  current: FriendFolderNode;
  children: FriendFolderNode[];
  entries: FriendReferenceEntry[];
  files: FriendReferenceFile[];
  recordings: FriendReferenceRecording[];
  onOpen: (id: string) => void;
  embedded?: boolean;
}) {
  const localFiles = files.filter((item) => item.node_id === current.id);
  const recordingEntryIds = new Set(
    recordings.filter((item) => item.node_id === current.id).map((item) => item.id)
  );
  const localEntries = entries.filter(
    (item) => item.node_id === current.id && !item.source_file_id && !recordingEntryIds.has(item.id)
  );
  const localRecordings = recordings.filter((item) => item.node_id === current.id);

  return (
    <section className="friendFolderPage">
      {!embedded && (
        <div className="friendFolderHero">
          <div>
            <p className="eyebrow">RUANG BELAJAR TEMAN</p>
            <h1>
              <span aria-hidden="true">{current.emoji || "📁"}</span>
              {current.title}
            </h1>
            <p className="muted">
              Kamu sedang melihat Ruang Belajar teman. Isinya hanya dapat dilihat; Tanya AI tetap memakai sumber dari profil ini.
            </p>
          </div>
          <span className="friendReadOnlyBadge">Hanya lihat</span>
        </div>
      )}

      {!!children.length && (
        <div className="socialRoomGrid friendSubfolderGrid">
          {children.map((node) => (
            <article
              className="socialRoomCard"
              data-color={node.card_color || "default"}
              key={node.id}
            >
              <button
                type="button"
                className="socialRoomOpen"
                onClick={() => onOpen(node.id)}
              >
                <span className="socialRoomIcon">{node.emoji || "📁"}</span>
                <span className="socialRoomCopy">
                  <small>Subfolder</small>
                  <strong>{node.title}</strong>
                </span>
              </button>
            </article>
          ))}
        </div>
      )}

      {!!(localFiles.length || localEntries.length || localRecordings.length) && (
        <div className="friendReferenceList">
          {localEntries.map((entry) => (
            <article className="friendReferenceCard" key={entry.id}>
              <span>📝</span>
              <div><small>{entry.category || "Catatan"}</small><strong>{entry.title}</strong></div>
            </article>
          ))}
          {localFiles.map((file) => (
            <article className="friendReferenceCard" key={file.id}>
              <span>{file.source_kind === "link" ? "🔗" : file.mime_type === "application/pdf" ? "📕" : "📄"}</span>
              <div><small>{file.source_kind === "link" ? "Link Reference" : "File Reference"}</small><strong>{file.file_name}</strong></div>
            </article>
          ))}
          {localRecordings.map((recording) => (
            <article className="friendReferenceCard" key={recording.id}>
              <span>🎙️</span>
              <div><small>Rekaman</small><strong>{recording.title}</strong></div>
            </article>
          ))}
        </div>
      )}

      {!children.length && !localFiles.length && !localEntries.length && !localRecordings.length && (
        <div className="socialRoomsEmpty">
          <span>📂</span>
          <p>Folder ini belum memiliki Reference yang dapat dibaca.</p>
        </div>
      )}
    </section>
  );
}
