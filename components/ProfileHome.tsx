"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type SocialRoomCard = {
  id: string;
  title: string;
  emoji?: string | null;
  card_color?: string | null;
};

type UserProfile = {
  user_id: string;
  username: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  auto_accept_friends: boolean;
  created_at?: string;
};

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
    <span className={large ? "socialAvatar socialAvatarLarge" : "socialAvatar"}>
      {profile?.avatar_url ? (
        <img src={profile.avatar_url} alt="" referrerPolicy="no-referrer" />
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
  onAccessChange,
  onProfileChanged,
}: {
  session: Session;
  ownerUserId: string;
  rooms: SocialRoomCard[];
  onOpenRoom: (roomId: string) => void;
  onOpenProfile: (userId: string) => void;
  onAddRoom: () => void;
  onAccessChange: (canReadReference: boolean) => void;
  onProfileChanged?: () => void;
}) {
  const me = session.user.id;
  const ownProfile = ownerUserId === me;
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [stats, setStats] = useState({ study_rooms: 0, friends: 0 });
  const [relationship, setRelationship] = useState<RelationshipState>(ownProfile ? "self" : "none");
  const [connection, setConnection] = useState<FriendConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

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
    setProfile(null);
    setRelationship(ownProfile ? "self" : "none");
    setConnection(null);
    void refreshProfile();
  }, [ownerUserId, me]);

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
              <h1>{profile?.display_name || profile?.username || "Profil Ruang Belajar"}</h1>
              <p>@{profile?.username || "memuat..."}</p>
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

          {ownProfile && (
            <div className="socialFriendSettingSummary">
              <span>{profile?.auto_accept_friends ? "Auto-accept teman aktif" : "Permintaan teman perlu konfirmasi"}</span>
              <small>Default aman: konfirmasi manual.</small>
            </div>
          )}
        </div>
      </div>

      <div className="socialRoomsHead">
        <div>
          <p className="eyebrow">{ownProfile ? "PROFIL SAYA" : "PROFIL TEMAN"}</p>
          <h2>Ruang Belajar</h2>
        </div>
        {ownProfile && <button type="button" className="primary socialAddRoom" onClick={onAddRoom}>+ Ruang Belajar</button>}
      </div>

      {canReadReference ? (
        rooms.length ? (
          <div className="socialRoomGrid">
            {rooms.map((room) => (
              <button
                type="button"
                className="socialRoomCard"
                data-color={room.card_color || "default"}
                key={room.id}
                onClick={() => onOpenRoom(room.id)}
              >
                <span className="socialRoomIcon">{room.emoji || "📁"}</span>
                <span>
                  <small>Ruang Belajar</small>
                  <strong>{room.title}</strong>
                </span>
              </button>
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

function EditProfileSheet({
  profile,
  onClose,
  onSaved,
}: {
  profile: UserProfile;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState(profile.display_name || "");
  const [username, setUsername] = useState(profile.username || "");
  const [bio, setBio] = useState(profile.bio || "");
  const [autoAccept, setAutoAccept] = useState(profile.auto_accept_friends);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState("");

  async function save() {
    const safeUsername = username.toLowerCase().replace(/[^a-z0-9._]/g, "").slice(0, 32);
    if (safeUsername.length < 3) {
      setErrorText("Username minimal 3 karakter.");
      return;
    }
    setBusy(true);
    setErrorText("");
    const { error } = await supabase
      .from("user_profiles")
      .update({
        username: safeUsername,
        display_name: displayName.trim().slice(0, 80),
        bio: bio.trim().slice(0, 220),
        auto_accept_friends: autoAccept,
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
    <div className="sheetBackdrop" onMouseDown={() => !busy && onClose()}>
      <section className="addSheet socialEditSheet" onMouseDown={(event) => event.stopPropagation()}>
        <div className="sheetHead">
          <div>
            <p className="eyebrow">PROFIL</p>
            <h2>Edit profil</h2>
          </div>
          <button className="closeBtn" type="button" disabled={busy} onClick={onClose}>×</button>
        </div>
        <div className="stack">
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
          <label className="socialToggleRow">
            <span>
              <strong>Auto-accept teman</strong>
              <small>Jika mati, setiap permintaan harus kamu terima dulu. Default: mati.</small>
            </span>
            <input type="checkbox" checked={autoAccept} onChange={(e) => setAutoAccept(e.target.checked)} />
          </label>
          {errorText && <div className="notice">{errorText}</div>}
          <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Menyimpan..." : "Simpan profil"}
          </button>
        </div>
      </section>
    </div>
  );
}

function FriendCenter({
  session,
  ownProfile,
  onClose,
  onOpenProfile,
  onProfileUpdated,
}: {
  session: Session;
  ownProfile: UserProfile | null;
  onClose: () => void;
  onOpenProfile: (userId: string) => void;
  onProfileUpdated: () => void;
}) {
  const me = session.user.id;
  const [connections, setConnections] = useState<FriendConnection[]>([]);
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserProfile[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState("");
  const [autoAccept, setAutoAccept] = useState(Boolean(ownProfile?.auto_accept_friends));

  async function refreshConnections() {
    const { data, error } = await supabase
      .from("friend_connections")
      .select("*")
      .or("requester_id.eq." + me + ",addressee_id.eq." + me)
      .order("updated_at", { ascending: false });
    if (error) return;

    const rows = (data || []) as FriendConnection[];
    setConnections(rows);
    const ids = Array.from(new Set(rows.flatMap((row) => [row.requester_id, row.addressee_id]).filter((id) => id !== me)));
    if (!ids.length) {
      setProfiles({});
      return;
    }
    const { data: profileRows } = await supabase.from("user_profiles").select("*").in("user_id", ids);
    setProfiles(Object.fromEntries(((profileRows || []) as UserProfile[]).map((item) => [item.user_id, item])));
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

  return (
    <div className="sheetBackdrop" onMouseDown={onClose}>
      <section className="addSheet friendCenterSheet" onMouseDown={(event) => event.stopPropagation()}>
        <div className="sheetHead">
          <div>
            <p className="eyebrow">SOSIAL</p>
            <h2>Teman</h2>
          </div>
          <button type="button" className="closeBtn" onClick={onClose}>×</button>
        </div>

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
      </section>
    </div>
  );
}
