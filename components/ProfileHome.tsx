"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type SocialRoomCard = {
  id: string;
  title: string;
  emoji?: string | null;
  card_color?: string | null;
};

export type UserProfile = {
  user_id: string;
  username: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  avatar_emoji: string;
  avatar_bg_color: string;
  onboarding_completed?: boolean;
  auto_accept_friends: boolean;
  last_active_at?: string | null;
  created_at?: string;
};

const STUDY_PROFILE_EMOJIS = ["📚","🧠","🎓","🔬","🧪","💡","✍️","🌱","🚀","🧩","📐","🩺"];
const PROFILE_BG_COLORS = ["#10231d","#D55B82","#5B7FD5","#6A5BD5","#0E9AA7","#E57A1F","#6A8E3A","#4A5568","#8A5A44","#B14F7A","#2B6F6D","#B08A2E"];

type FriendConnection = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: "pending" | "accepted" | "declined";
  created_at: string;
  updated_at: string;
  accepted_at?: string | null;
};

type RelationshipState = "self" | "accepted" | "incoming" | "outgoing" | "none";

function initials(profile: UserProfile | null) {
  const value = profile?.display_name || profile?.username || "RB";
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("") || "RB";
}

function ProfileAvatar({ profile, large = false }: { profile: UserProfile | null; large?: boolean }) {
  return (
    <span
      className={large ? "socialAvatar socialAvatarLarge" : "socialAvatar"}
      style={!profile?.avatar_url ? { background: profile?.avatar_bg_color || "#10231d" } : undefined}
    >
      {profile?.avatar_url ? (
        <img src={profile.avatar_url} alt="" referrerPolicy="no-referrer" />
      ) : profile?.avatar_emoji ? (
        <span className="socialAvatarEmoji" aria-hidden="true">{profile.avatar_emoji}</span>
      ) : (
        <b aria-hidden="true">{initials(profile)}</b>
      )}
    </span>
  );
}

export default function ProfileHome({
  session,
  ownerUserId,
  rooms,
  onOpenRoom,
  onOpenProfile,
  onAddRoom,
  onCustomizeRoom,
  onDeleteRoom,
  onAccessChange,
  onProfileChanged,
  openFriendsRequest = 0,
  openEditRequest = 0,
  activeFolder = null,
  activeFolderPath = [],
  activeContent = null,
  onBackToRooms,
  onOpenFolderPath,
  onBreadcrumbDrop,
  onCustomizeActive,
  onUploadActive,
}: {
  session: Session;
  ownerUserId: string;
  rooms: SocialRoomCard[];
  onOpenRoom: (roomId: string) => void;
  onOpenProfile: (userId: string) => void;
  onAddRoom: () => void;
  onCustomizeRoom?: (roomId: string) => void;
  onDeleteRoom?: (roomId: string) => void;
  onAccessChange: (canReadReference: boolean) => void;
  onProfileChanged?: () => void;
  openFriendsRequest?: number;
  openEditRequest?: number;
  activeFolder?: SocialRoomCard | null;
  activeFolderPath?: Array<{ id: string; title: string }>;
  activeContent?: React.ReactNode;
  onBackToRooms?: () => void;
  onOpenFolderPath?: (folderId: string) => void;
  onBreadcrumbDrop?: (event: any, targetNodeId: string | null) => void;
  onCustomizeActive?: () => void;
  onUploadActive?: () => void;
}) {
  const me = session.user.id;
  const ownProfile = ownerUserId === me;
  const emailLocal = String(session.user.email || "akun").split("@")[0] || "akun";
  const fallbackUsername = emailLocal.toLowerCase().replace(/[^a-z0-9._]/g, "").slice(0, 32) || "akun";
  const ownFallbackProfile = useMemo<UserProfile>(() => ({
    user_id: me,
    username: fallbackUsername.length >= 3 ? fallbackUsername : "akun",
    display_name: emailLocal,
    bio: "",
    avatar_url: null,
    avatar_emoji: "📚",
    avatar_bg_color: "#10231d",
    onboarding_completed: false,
    auto_accept_friends: false,
  }), [me, emailLocal, fallbackUsername, session.user.user_metadata]);
  const [profile, setProfile] = useState<UserProfile | null>(
    ownProfile ? ownFallbackProfile : null
  );
  const [stats, setStats] = useState({ study_rooms: 0, friends: 0 });
  const [relationship, setRelationship] = useState<RelationshipState>(ownProfile ? "self" : "none");
  const [connection, setConnection] = useState<FriendConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [roomMenuId, setRoomMenuId] = useState<string | null>(null);


  async function refreshProfile() {
    const [profileResult, statsResult] = await Promise.all([
      supabase.from("user_profiles").select("*").eq("user_id", ownerUserId).maybeSingle(),
      supabase.rpc("profile_social_stats", { p_user_id: ownerUserId }),
    ]);
    if (!profileResult.error && profileResult.data) {
      setProfile(profileResult.data as UserProfile);
    }
    if (!statsResult.error && Array.isArray(statsResult.data) && statsResult.data[0]) {
      setStats({
        study_rooms: Number(statsResult.data[0].study_rooms || 0),
        friends: Number(statsResult.data[0].friends || 0),
      });
    }

    if (ownProfile) {
      setConnection(null);
      setRelationship("self");
      onAccessChange(true);
      return;
    }

    const { data } = await supabase
      .from("friend_connections")
      .select("*")
      .or(
        "and(requester_id.eq." + me + ",addressee_id.eq." + ownerUserId + ")," +
        "and(requester_id.eq." + ownerUserId + ",addressee_id.eq." + me + ")"
      )
      .limit(1)
      .maybeSingle();

    const row = (data || null) as FriendConnection | null;
    setConnection(row);
    if (!row || row.status === "declined") {
      setRelationship("none");
      onAccessChange(false);
    } else if (row.status === "accepted") {
      setRelationship("accepted");
      onAccessChange(true);
    } else if (row.requester_id === me) {
      setRelationship("outgoing");
      onAccessChange(false);
    } else {
      setRelationship("incoming");
      onAccessChange(false);
    }
  }

  useEffect(() => {
    // Own profile never renders as "memuat..."—the email local-part is an
    // immediate, deterministic fallback until the editable profile row arrives.
    setProfile(ownProfile ? ownFallbackProfile : null);
    setRelationship(ownProfile ? "self" : "none");
    setConnection(null);
    void refreshProfile();
  }, [ownerUserId, me, ownProfile, ownFallbackProfile]);

  useEffect(() => {
    if (ownProfile && openFriendsRequest > 0) setFriendsOpen(true);
  }, [openFriendsRequest, ownProfile]);

  useEffect(() => {
    if (ownProfile && openEditRequest > 0) setEditOpen(true);
  }, [openEditRequest, ownProfile]);


  async function sendRequest() {
    setBusy(true);
    const { error } = await supabase.rpc("send_friend_request", { p_target_user_id: ownerUserId });
    setBusy(false);
    if (error) return alert(error.message);
    await refreshProfile();
    onProfileChanged?.();
  }

  async function respond(accept: boolean) {
    if (!connection) return;
    setBusy(true);
    const { error } = await supabase.rpc("respond_friend_request", {
      p_connection_id: connection.id,
      p_accept: accept,
    });
    setBusy(false);
    if (error) return alert(error.message);
    await refreshProfile();
    onProfileChanged?.();
  }

  async function cancelRequest() {
    setBusy(true);
    const { error } = await supabase.rpc("cancel_friend_request", { p_other_user_id: ownerUserId });
    setBusy(false);
    if (error) return alert(error.message);
    await refreshProfile();
    onProfileChanged?.();
  }

  async function removeFriend() {
    if (!window.confirm("Hapus " + (profile?.display_name || profile?.username || "akun ini") + " dari teman?")) return;
    setBusy(true);
    const { error } = await supabase.rpc("remove_friend", { p_other_user_id: ownerUserId });
    setBusy(false);
    if (error) return alert(error.message);
    await refreshProfile();
    onProfileChanged?.();
  }

  const canReadReference = relationship === "self" || relationship === "accepted";

  return (
    <section className="socialProfilePage">
      <div className="socialProfileHero">
        <ProfileAvatar profile={profile} large />
        <div className="socialProfileIdentity">
          <div className="socialProfileNameRow">
            <div>
              <h1>{profile?.display_name || profile?.username || (ownProfile ? emailLocal : "Profil")}</h1>
              <p>@{profile?.username || (ownProfile ? fallbackUsername : "profil")}</p>
            </div>
            <div className="socialProfileActions">
              {ownProfile ? (
                <>
                  <button type="button" className="primary" onClick={() => setEditOpen(true)}>Edit profil</button>
                  <button type="button" className="ghost" onClick={() => setFriendsOpen(true)}>Teman</button>
                </>
              ) : relationship === "accepted" ? (
                <>
                  <button type="button" className="primary socialFriendAccepted" disabled>Teman ✓</button>
                  <button type="button" className="ghost" disabled={busy} onClick={removeFriend}>Hapus teman</button>
                </>
              ) : relationship === "incoming" ? (
                <>
                  <button type="button" className="primary" disabled={busy} onClick={() => void respond(true)}>
                    {busy ? "Memproses..." : "Terima"}
                  </button>
                  <button type="button" className="ghost" disabled={busy} onClick={() => void respond(false)}>Tolak</button>
                </>
              ) : relationship === "outgoing" ? (
                <button type="button" className="ghost" disabled={busy} onClick={cancelRequest}>
                  {busy ? "Memproses..." : "Permintaan terkirim"}
                </button>
              ) : (
                <button type="button" className="primary" disabled={busy} onClick={sendRequest}>
                  {busy ? "Mengirim..." : "Tambah teman"}
                </button>
              )}
            </div>
          </div>

          <div className="socialProfileStats">
            <div>
              <strong>{stats.study_rooms}</strong>
              <span>Ruang Belajar</span>
            </div>
            <button
              type="button"
              className={ownProfile ? "socialStatButton" : "socialStatButton static"}
              onClick={() => ownProfile && setFriendsOpen(true)}
              disabled={!ownProfile}
            >
              <strong>{stats.friends}</strong>
              <span>Teman</span>
            </button>
          </div>

          {profile?.bio ? <p className="socialProfileBio">{profile.bio}</p> : ownProfile ? (
            <p className="socialProfileBio muted">Tambahkan bio singkat agar teman lebih mudah mengenal profil Ruang Belajar kamu.</p>
          ) : null}

        </div>
      </div>

      <div className={activeFolder ? "socialRoomsHead socialRoomsHeadNested" : "socialRoomsHead socialRoomsHeadHome"}>
        <div>
          {activeFolder ? (
            <>
              <div className="profileFolderBreadcrumb" aria-label="Lokasi folder">
                <button
                  type="button"
                  data-rb-drop-target="__root__"
                  onClick={onBackToRooms}
                  onDragOver={(event) => {
                    if (!ownProfile || !onBreadcrumbDrop) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => {
                    if (!ownProfile || !onBreadcrumbDrop) return;
                    onBreadcrumbDrop(event, null);
                  }}
                >
                  Home
                </button>
                {[...activeFolderPath, { id: activeFolder.id, title: activeFolder.title }].map((item) => (
                  <span key={item.id}>
                    <b>/</b>
                    <button
                      type="button"
                      data-rb-drop-target={item.id}
                      onClick={() => onOpenFolderPath?.(item.id)}
                      onDragOver={(event) => {
                        if (!ownProfile || !onBreadcrumbDrop) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(event) => {
                        if (!ownProfile || !onBreadcrumbDrop) return;
                        onBreadcrumbDrop(event, item.id);
                      }}
                    >
                      {item.title}
                    </button>
                  </span>
                ))}
              </div>
            </>
          ) : (
            <>
              {!ownProfile && <p className="eyebrow">PROFIL TEMAN</p>}
              <div className="profileFolderBreadcrumb profileHomeBreadcrumb" aria-label="Lokasi folder">
                <button
                  type="button"
                  data-rb-drop-target="__root__"
                  onClick={onBackToRooms}
                  onDragOver={(event) => {
                    if (!ownProfile || !onBreadcrumbDrop) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => {
                    if (!ownProfile || !onBreadcrumbDrop) return;
                    onBreadcrumbDrop(event, null);
                  }}
                >
                  Home
                </button>
              </div>
            </>
          )}
        </div>
        {ownProfile && (
          <div className="socialRoomHeadActions">
            {activeFolder && onCustomizeActive && (
              <button type="button" className="ghost socialFolderCustomize" onClick={onCustomizeActive}>
                Sesuaikan
              </button>
            )}
            <button
              type="button"
              className="primary socialAddRoom"
              onClick={activeFolder ? onUploadActive : onAddRoom}
            >
              + Upload
            </button>
          </div>
        )}
      </div>

      {canReadReference ? (
        activeContent ? (
          <div className="socialEmbeddedFolder">{activeContent}</div>
        ) : rooms.length ? (
          <div className="socialRoomGrid">
            {rooms.map((room) => (
              <article
                className="socialRoomCard"
                data-color={room.card_color || "default"}
                key={room.id}
                onContextMenu={(event) => {
                  if (!ownProfile) return;
                  event.preventDefault();
                  setRoomMenuId(room.id);
                }}
              >
                <button
                  type="button"
                  className="socialRoomOpen"
                  onClick={() => {
                    setRoomMenuId(null);
                    onOpenRoom(room.id);
                  }}
                >
                  <span className="socialRoomIcon">{room.emoji || "📁"}</span>
                  <span className="socialRoomCopy">
                    <small>Ruang Belajar</small>
                    <strong>{room.title}</strong>
                  </span>
                </button>
                {ownProfile && (
                  <>
                    <button
                      type="button"
                      className="socialRoomDots"
                      aria-label={"Opsi " + room.title}
                      onClick={(event) => {
                        event.stopPropagation();
                        setRoomMenuId((current) => current === room.id ? null : room.id);
                      }}
                    >...</button>
                    {roomMenuId === room.id && (
                      <div className="socialRoomMenu">
                        <button type="button" onClick={() => { setRoomMenuId(null); onOpenRoom(room.id); }}>Buka</button>
                        {onCustomizeRoom && <button type="button" onClick={() => { setRoomMenuId(null); onCustomizeRoom(room.id); }}>Sesuaikan</button>}
                        {onDeleteRoom && <button type="button" className="dangerMenuItem" onClick={() => { setRoomMenuId(null); onDeleteRoom(room.id); }}>Hapus</button>}
                      </div>
                    )}
                  </>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="socialRoomsEmpty">
            <span>📚</span>
            <p>{ownProfile ? "Belum ada Ruang Belajar. Buat folder pertama dari profil ini." : "Teman ini belum memiliki Ruang Belajar yang dapat dibuka."}</p>
          </div>
        )
      ) : (
        <div className="socialReferenceLocked">
          <span>🔒</span>
          <div>
            <strong>Reference belum dibuka</strong>
            <p>Ruang Belajar dan fitur Tanya AI dari akun ini tersedia setelah kalian menjadi teman.</p>
          </div>
        </div>
      )}

      {friendsOpen && ownProfile && (
        <FriendCenter
          session={session}
          ownProfile={profile}
          onClose={() => setFriendsOpen(false)}
          onOpenProfile={(userId) => {
            setFriendsOpen(false);
            onOpenProfile(userId);
          }}
          onProfileUpdated={async () => {
            await refreshProfile();
            onProfileChanged?.();
          }}
        />
      )}

      {editOpen && ownProfile && profile && (
        <EditProfileSheet
          profile={profile}
          onClose={() => setEditOpen(false)}
          onSaved={async () => {
            setEditOpen(false);
            await refreshProfile();
            onProfileChanged?.();
          }}
        />
      )}
    </section>
  );
}

function AvatarCropEditor({
  src,
  onPick,
  onCropReady,
}: {
  src: string;
  onPick: () => void;
  onCropReady: (blob: Blob) => void;
}) {
  const viewportRef = useRef<HTMLButtonElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const cropTimerRef = useRef<number | null>(null);
  const onCropReadyRef = useRef(onCropReady);
  const [viewport, setViewport] = useState(260);
  const [natural, setNatural] = useState({ w: 1, h: 1 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const baseScale = Math.max(viewport / natural.w, viewport / natural.h);
  const scale = baseScale * zoom;
  const drawW = natural.w * scale;
  const drawH = natural.h * scale;
  const maxX = Math.max(0, (drawW - viewport) / 2);
  const maxY = Math.max(0, (drawH - viewport) / 2);
  const clamped = {
    x: Math.max(-maxX, Math.min(maxX, offset.x)),
    y: Math.max(-maxY, Math.min(maxY, offset.y)),
  };

  useEffect(() => {
    onCropReadyRef.current = onCropReady;
  }, [onCropReady]);

  useEffect(() => {
    setOffset((current) => ({
      x: Math.max(-maxX, Math.min(maxX, current.x)),
      y: Math.max(-maxY, Math.min(maxY, current.y)),
    }));
  }, [zoom, natural.w, natural.h, viewport, maxX, maxY]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const syncSize = () => setViewport(Math.max(1, element.clientWidth || 260));
    syncSize();
    const observer = new ResizeObserver(syncSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!src) return;
    const img = imgRef.current;
    if (!img || !img.complete || natural.w <= 1 || natural.h <= 1) return;

    if (cropTimerRef.current) window.clearTimeout(cropTimerRef.current);
    cropTimerRef.current = window.setTimeout(() => {
      const liveImg = imgRef.current;
      if (!liveImg) return;

      const left = (viewport - drawW) / 2 + clamped.x;
      const top = (viewport - drawH) / 2 + clamped.y;
      const sourceX = Math.max(0, -left / scale);
      const sourceY = Math.max(0, -top / scale);
      const sourceSize = viewport / scale;

      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(
        liveImg,
        sourceX,
        sourceY,
        Math.min(sourceSize, natural.w - sourceX),
        Math.min(sourceSize, natural.h - sourceY),
        0,
        0,
        512,
        512
      );
      canvas.toBlob((blob) => {
        if (blob) onCropReadyRef.current(blob);
      }, "image/jpeg", 0.9);
    }, 120);

    return () => {
      if (cropTimerRef.current) window.clearTimeout(cropTimerRef.current);
    };
  }, [src, viewport, drawW, drawH, clamped.x, clamped.y, scale, natural.w, natural.h]);

  return (
    <div className="avatarCropPanel profilePhotoInlinePanel">
      <button
        ref={viewportRef}
        type="button"
        className={src ? "avatarCropViewport hasPhoto" : "avatarCropViewport emptyPhoto"}
        onClick={() => {
          if (!src) onPick();
        }}
        onPointerDown={(event) => {
          if (!src) return;
          dragRef.current = { x: event.clientX, y: event.clientY, ox: clamped.x, oy: clamped.y };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!src || !dragRef.current) return;
          const nextX = dragRef.current.ox + event.clientX - dragRef.current.x;
          const nextY = dragRef.current.oy + event.clientY - dragRef.current.y;
          setOffset({
            x: Math.max(-maxX, Math.min(maxX, nextX)),
            y: Math.max(-maxY, Math.min(maxY, nextY)),
          });
        }}
        onPointerUp={() => { dragRef.current = null; }}
        onPointerCancel={() => { dragRef.current = null; }}
        aria-label={src ? "Atur posisi foto profil" : "Pilih foto dari perangkat"}
      >
        {src ? (
          <>
            <img
              ref={imgRef}
              src={src}
              alt=""
              draggable={false}
              onLoad={(event) => {
                const img = event.currentTarget;
                setNatural({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
                setOffset({ x: 0, y: 0 });
                setZoom(1);
              }}
              style={{
                width: drawW,
                height: drawH,
                left: (viewport - drawW) / 2 + clamped.x,
                top: (viewport - drawH) / 2 + clamped.y,
              }}
            />
            <span className="avatarCropGuide" aria-hidden="true" />
          </>
        ) : (
          <span className="avatarCropEmptyState">
            <small>Masukkan foto</small>
          </span>
        )}
      </button>

      <label className={src ? "avatarZoomControl" : "avatarZoomControl disabled"}>
        <span>Zoom</span>
        <input
          type="range"
          min="1"
          max="3"
          step="0.01"
          value={zoom}
          disabled={!src}
          onChange={(event) => setZoom(Number(event.target.value))}
        />
      </label>

      {src && (
        <small className="muted">
          Geser foto di dalam lingkaran dan atur zoom. Hasilnya baru tersimpan setelah klik Simpan profil.
        </small>
      )}
    </div>
  );
}

export function ProfileEditorPanel({
  profile,
  onSaved,
  submitLabel = "Simpan profil",
}: {
  profile: UserProfile;
  onSaved: () => void;
  submitLabel?: string;
}) {
  const [displayName, setDisplayName] = useState(profile.display_name || "");
  const [username, setUsername] = useState(profile.username || "");
  const [bio, setBio] = useState(profile.bio || "");
  const [avatarEmoji, setAvatarEmoji] = useState(profile.avatar_emoji || "📚");
  const [avatarBgColor, setAvatarBgColor] = useState(profile.avatar_bg_color || "#10231d");
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url || "");
  const [avatarPreview, setAvatarPreview] = useState(profile.avatar_url || "");
  const [pendingAvatarBlob, setPendingAvatarBlob] = useState<Blob | null>(null);
  const [cropSrc, setCropSrc] = useState("");
  const [photoOptionsOpen, setPhotoOptionsOpen] = useState(false);
  const [avatarEditorMode, setAvatarEditorMode] = useState<"photo" | "emoji" | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState("");

  function chooseImage(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErrorText("Pilih file gambar.");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setErrorText("Gambar maksimal 12 MB sebelum dipotong.");
      return;
    }
    setErrorText("");
    const objectUrl = URL.createObjectURL(file);
    setCropSrc((previous) => {
      if (previous.startsWith("blob:")) URL.revokeObjectURL(previous);
      return objectUrl;
    });
  }

  function openEmojiAvatarEditor() {
    setAvatarEditorMode("emoji");
  }

  function activateEmojiAvatar(nextEmoji = avatarEmoji, nextColor = avatarBgColor) {
    if (avatarPreview.startsWith("blob:")) URL.revokeObjectURL(avatarPreview);
    setPendingAvatarBlob(null);
    setAvatarPreview("");
    setAvatarUrl("");
    setCropSrc("");
    setAvatarEmoji(nextEmoji);
    setAvatarBgColor(nextColor);
    setAvatarEditorMode("emoji");
  }

  async function save() {
    const safeUsername = username.toLowerCase().replace(/[^a-z0-9._]/g, "").slice(0, 32);
    if (safeUsername.length < 3) {
      setErrorText("Username minimal 3 karakter.");
      return;
    }
    if (!displayName.trim()) {
      setErrorText("Nama profil tidak boleh kosong.");
      return;
    }

    setBusy(true);
    setErrorText("");

    let nextAvatarUrl = avatarUrl;
    if (pendingAvatarBlob) {
      const path = profile.user_id + "/avatar-" + Date.now() + ".jpg";
      const upload = await supabase.storage
        .from("profile-avatars")
        .upload(path, pendingAvatarBlob, { contentType: "image/jpeg", upsert: false });
      if (upload.error) {
        setBusy(false);
        setErrorText(upload.error.message);
        return;
      }
      nextAvatarUrl = supabase.storage.from("profile-avatars").getPublicUrl(path).data.publicUrl;
    }

    const { error } = await supabase
      .from("user_profiles")
      .update({
        username: safeUsername,
        display_name: displayName.trim().slice(0, 80),
        bio: bio.trim().slice(0, 220),
        avatar_emoji: avatarEmoji || "📚",
        avatar_bg_color: avatarBgColor,
        avatar_url: nextAvatarUrl || null,
        onboarding_completed: true,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", profile.user_id);

    setBusy(false);
    if (error) {
      setErrorText(error.code === "23505" ? "Username sudah dipakai akun lain." : error.message);
      return;
    }
    onSaved();
  }

  return (
    <div className="stack profileEditorPanel">
      <div className="profilePhotoEditor">
        <div
          className="profilePhotoPreview"
          style={!avatarPreview ? { background: avatarBgColor } : undefined}
        >
          {avatarPreview ? (
            <img src={avatarPreview} alt="Foto profil" />
          ) : (
            <span>{avatarEmoji || "📚"}</span>
          )}
        </div>
        <div className="profilePhotoEditorMain">
          <strong>Foto profil</strong>
          <small className="muted">Foto atau avatar emoji yang tampil di profil dan daftar teman.</small>
          <button
            type="button"
            className="ghost profileChangePhotoButton"
            onClick={() => {
              setPhotoOptionsOpen((value) => !value);
              if (photoOptionsOpen) setAvatarEditorMode(null);
            }}
          >
            Ubah foto profil
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        className="profilePhotoHiddenInput"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(event) => {
          chooseImage(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />

      {photoOptionsOpen && (
        <div className="profileAvatarOptions">
          <button
            type="button"
            className={avatarEditorMode === "photo" ? "profileAvatarOption active" : "profileAvatarOption"}
            onClick={() => setAvatarEditorMode("photo")}
          >
            <span>🖼️</span>
            <div>
              <strong>Foto</strong>
              <small>Pilih gambar, lalu atur posisi dan zoom.</small>
            </div>
          </button>
          <button
            type="button"
            className={avatarEditorMode === "emoji" ? "profileAvatarOption active" : "profileAvatarOption"}
            onClick={openEmojiAvatarEditor}
          >
            <span>🙂</span>
            <div>
              <strong>Emoji</strong>
              <small>Pilih emoji dan warna background.</small>
            </div>
          </button>
        </div>
      )}

      {avatarEditorMode === "emoji" && photoOptionsOpen && (
        <div className="profileEmojiEditor">
          <div className="profileEmojiField">
            <span className="profileEmojiLabel">Emoji</span>
            <div className="profileEmojiGrid">
              {STUDY_PROFILE_EMOJIS.map((emoji) => (
                <button
                  type="button"
                  key={emoji}
                  className={avatarEmoji === emoji ? "profileEmojiChoice active" : "profileEmojiChoice"}
                  onClick={() => activateEmojiAvatar(emoji, avatarBgColor)}
                  aria-label={"Pilih avatar " + emoji}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
          <div className="profileColorField">
            <span className="profileEmojiLabel">Warna background</span>
            <div className="profileColorGrid">
              {PROFILE_BG_COLORS.map((color) => (
                <button
                  type="button"
                  key={color}
                  className={avatarBgColor === color ? "profileColorChoice active" : "profileColorChoice"}
                  style={{ background: color }}
                  aria-label={"Pilih warna " + color}
                  onClick={() => activateEmojiAvatar(avatarEmoji, color)}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {avatarEditorMode === "photo" && photoOptionsOpen && (
        <AvatarCropEditor
          src={cropSrc}
          onPick={() => fileInputRef.current?.click()}
          onCropReady={(blob) => {
            setPendingAvatarBlob(blob);
            setAvatarPreview((previous) => {
              if (previous.startsWith("blob:")) URL.revokeObjectURL(previous);
              return URL.createObjectURL(blob);
            });
          }}
        />
      )}

      <label>Nama
        <input value={displayName} maxLength={80} onChange={(e) => setDisplayName(e.target.value)} />
      </label>
      <label>Username
        <div className="socialUsernameInput"><span>@</span><input value={username} maxLength={32} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._]/g, ""))} /></div>
      </label>
      <label>Bio
        <textarea rows={4} value={bio} maxLength={220} onChange={(e) => setBio(e.target.value)} />
        <small className="muted">{bio.length}/220</small>
      </label>
      {errorText && <div className="notice">{errorText}</div>}
      <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
        {busy ? "Menyimpan..." : submitLabel}
      </button>
    </div>
  );
}

function EditProfileSheet({
  profile,
  onClose,
  onSaved,
}: {
  profile: UserProfile;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <div className="sheetBackdrop" onMouseDown={onClose}>
      <section className="addSheet socialEditSheet" onMouseDown={(event) => event.stopPropagation()}>
        <div className="sheetHead">
          <div>
            <p className="eyebrow">PROFIL</p>
            <h2>Edit profil</h2>
          </div>
          <button className="closeBtn" type="button" onClick={onClose}>×</button>
        </div>
        <ProfileEditorPanel profile={profile} onSaved={onSaved} />
      </section>
    </div>
  );
}

export function FriendCenter({
  session,
  ownProfile,
  onClose,
  onOpenProfile,
  onProfileUpdated,
  embedded = false,
}: {
  session: Session;
  ownProfile: UserProfile | null;
  onClose: () => void;
  onOpenProfile: (userId: string) => void;
  onProfileUpdated: () => void;
  embedded?: boolean;
}) {
  const me = session.user.id;
  const [connections, setConnections] = useState<FriendConnection[]>([]);
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserProfile[]>([]);
  const [recommendations, setRecommendations] = useState<UserProfile[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState("");
  const [autoAccept, setAutoAccept] = useState(Boolean(ownProfile?.auto_accept_friends));

  useEffect(() => {
    setAutoAccept(Boolean(ownProfile?.auto_accept_friends));
  }, [ownProfile?.auto_accept_friends]);

  async function refreshConnections() {
    const { data, error } = await supabase
      .from("friend_connections")
      .select("*")
      .or("requester_id.eq." + me + ",addressee_id.eq." + me)
      .order("updated_at", { ascending: false });
    if (error) return;

    const rows = (data || []) as FriendConnection[];
    setConnections(rows);

    const connectedIds = new Set(
      rows
        .filter((row) => row.status !== "declined")
        .map((row) => row.requester_id === me ? row.addressee_id : row.requester_id)
    );

    const ids = Array.from(new Set(rows.flatMap((row) => [row.requester_id, row.addressee_id]).filter((id) => id !== me)));
    if (!ids.length) {
      setProfiles({});
    } else {
      const { data: profileRows } = await supabase.from("user_profiles").select("*").in("user_id", ids);
      setProfiles(Object.fromEntries(((profileRows || []) as UserProfile[]).map((item) => [item.user_id, item])));
    }

    const { data: suggestionRows } = await supabase
      .from("user_profiles")
      .select("*")
      .neq("user_id", me)
      .not("last_active_at", "is", null)
      .order("last_active_at", { ascending: false, nullsFirst: false })
      .limit(100);

    setRecommendations(
      ((suggestionRows || []) as UserProfile[])
        .filter((item) => !connectedIds.has(item.user_id))
    );
  }

  useEffect(() => {
    void refreshConnections();
  }, [me]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const term = query.trim().replace(/^@/, "");
      if (term.length < 2) {
        setResults([]);
        return;
      }
      void (async () => {
        setSearchBusy(true);
        const [byUsername, byName] = await Promise.all([
          supabase.from("user_profiles").select("*").ilike("username", "%" + term + "%").neq("user_id", me).limit(12),
          supabase.from("user_profiles").select("*").ilike("display_name", "%" + term + "%").neq("user_id", me).limit(12),
        ]);
        setSearchBusy(false);
        const merged = [...(byUsername.data || []), ...(byName.data || [])] as UserProfile[];
        setResults(Array.from(new Map(merged.map((item) => [item.user_id, item])).values()).slice(0, 12));
      })();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, me]);

  const incoming = connections.filter((row) => row.status === "pending" && row.addressee_id === me);
  const outgoing = connections.filter((row) => row.status === "pending" && row.requester_id === me);
  const accepted = connections.filter((row) => row.status === "accepted");

  const stateByUser = useMemo(() => {
    const map = new Map<string, RelationshipState>();
    for (const row of connections) {
      const other = row.requester_id === me ? row.addressee_id : row.requester_id;
      if (row.status === "accepted") map.set(other, "accepted");
      else if (row.status === "pending" && row.requester_id === me) map.set(other, "outgoing");
      else if (row.status === "pending") map.set(other, "incoming");
    }
    return map;
  }, [connections, me]);

  async function send(userId: string) {
    setActionBusy(userId);
    const { error } = await supabase.rpc("send_friend_request", { p_target_user_id: userId });
    setActionBusy("");
    if (error) return alert(error.message);
    await refreshConnections();
    onProfileUpdated();
  }

  async function respond(row: FriendConnection, accept: boolean) {
    setActionBusy(row.id);
    const { error } = await supabase.rpc("respond_friend_request", {
      p_connection_id: row.id,
      p_accept: accept,
    });
    setActionBusy("");
    if (error) return alert(error.message);
    await refreshConnections();
    onProfileUpdated();
  }

  async function remove(userId: string) {
    setActionBusy(userId);
    const { error } = await supabase.rpc("remove_friend", { p_other_user_id: userId });
    setActionBusy("");
    if (error) return alert(error.message);
    await refreshConnections();
    onProfileUpdated();
  }

  async function toggleAutoAccept(value: boolean) {
    setAutoAccept(value);
    const { error } = await supabase
      .from("user_profiles")
      .update({ auto_accept_friends: value })
      .eq("user_id", me);
    if (error) {
      setAutoAccept(!value);
      return alert(error.message);
    }
    onProfileUpdated();
  }

  function PersonRow({
    person,
    trailing,
  }: {
    person: UserProfile | undefined;
    trailing: React.ReactNode;
  }) {
    if (!person) return null;
    return (
      <div className="socialPersonRow">
        <button type="button" className="socialPersonMain" onClick={() => onOpenProfile(person.user_id)}>
          <ProfileAvatar profile={person} />
          <span>
            <strong>{person.display_name || person.username}</strong>
            <small>@{person.username}</small>
          </span>
        </button>
        <div className="socialPersonActions">{trailing}</div>
      </div>
    );
  }

  const content = (
    <>
      {!embedded && (
        <div className="sheetHead friendCenterHeader">
          <div>
            <p className="eyebrow">SOSIAL</p>
            <h2>Teman</h2>
          </div>
          <button type="button" className="closeBtn" onClick={onClose}>×</button>
        </div>
      )}

      <label className="socialToggleRow socialAutoAcceptSetting">
        <span>
          <strong>Auto-accept friend request</strong>
          <small>{autoAccept ? "Permintaan baru langsung menjadi teman." : "Setiap permintaan harus dikonfirmasi dulu."}</small>
        </span>
        <input type="checkbox" checked={autoAccept} onChange={(e) => void toggleAutoAccept(e.target.checked)} />
      </label>

      <div className="socialFriendSearch">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari nama atau @username"
        />
        {searchBusy && <small>Mencari...</small>}
      </div>

      {!query.trim() && recommendations.length > 0 && (
        <div className="socialPeopleSection socialRecommendationSection">
          <h3>Rekomendasi teman <span>{recommendations.length}</span></h3>
          <div className="socialRecommendationList">
            {recommendations.map((person) => (
              <PersonRow
                key={person.user_id}
                person={person}
                trailing={
                  <button
                    type="button"
                    className="primary"
                    disabled={actionBusy === person.user_id}
                    onClick={() => void send(person.user_id)}
                  >
                    {actionBusy === person.user_id ? "Mengirim..." : "Tambah"}
                  </button>
                }
              />
            ))}
          </div>
        </div>
      )}

      {!!query.trim() && (
        <div className="socialPeopleSection">
          <h3>Hasil pencarian</h3>
          {results.length ? results.map((person) => {
            const state = stateByUser.get(person.user_id) || "none";
            const incomingRow = incoming.find((row) => row.requester_id === person.user_id);
            return (
              <PersonRow
                key={person.user_id}
                person={person}
                trailing={
                  state === "accepted" ? (
                    <button type="button" className="ghost" onClick={() => onOpenProfile(person.user_id)}>Teman ✓</button>
                  ) : state === "outgoing" ? (
                    <button type="button" className="ghost" disabled>Menunggu</button>
                  ) : state === "incoming" && incomingRow ? (
                    <>
                      <button type="button" className="primary" disabled={actionBusy === incomingRow.id} onClick={() => void respond(incomingRow, true)}>Terima</button>
                      <button type="button" className="ghost" disabled={actionBusy === incomingRow.id} onClick={() => void respond(incomingRow, false)}>Tolak</button>
                    </>
                  ) : (
                    <button type="button" className="primary" disabled={actionBusy === person.user_id} onClick={() => void send(person.user_id)}>Tambah</button>
                  )
                }
              />
            );
          }) : !searchBusy ? <p className="muted">Tidak ada akun yang cocok.</p> : null}
        </div>
      )}

      {!!incoming.length && (
        <div className="socialPeopleSection">
          <h3>Permintaan masuk <span>{incoming.length}</span></h3>
          {incoming.map((row) => (
            <PersonRow
              key={row.id}
              person={profiles[row.requester_id]}
              trailing={
                <>
                  <button type="button" className="primary" disabled={actionBusy === row.id} onClick={() => void respond(row, true)}>Terima</button>
                  <button type="button" className="ghost" disabled={actionBusy === row.id} onClick={() => void respond(row, false)}>Tolak</button>
                </>
              }
            />
          ))}
        </div>
      )}

      <div className="socialPeopleSection">
        <h3>Teman <span>{accepted.length}</span></h3>
        {accepted.length ? accepted.map((row) => {
          const otherId = row.requester_id === me ? row.addressee_id : row.requester_id;
          return (
            <PersonRow
              key={row.id}
              person={profiles[otherId]}
              trailing={
                <>
                  <button type="button" className="ghost" onClick={() => onOpenProfile(otherId)}>Lihat profil</button>
                  <button type="button" className="dangerSmall" disabled={actionBusy === otherId} onClick={() => void remove(otherId)}>Hapus</button>
                </>
              }
            />
          );
        }) : <p className="muted">Belum ada teman yang diterima.</p>}
      </div>

      {!!outgoing.length && (
        <div className="socialPeopleSection">
          <h3>Menunggu konfirmasi <span>{outgoing.length}</span></h3>
          {outgoing.map((row) => (
            <PersonRow
              key={row.id}
              person={profiles[row.addressee_id]}
              trailing={<button type="button" className="ghost" disabled>Menunggu</button>}
            />
          ))}
        </div>
      )}
    </>
  );
  if (embedded) {
    return <section className="friendCenterEmbedded">{content}</section>;
  }

  return (
    <div className="sheetBackdrop friendCenterBackdrop" onMouseDown={onClose}>
      <section className="addSheet friendCenterSheet" onMouseDown={(event) => event.stopPropagation()}>
        {content}
      </section>
    </div>
  );
}
