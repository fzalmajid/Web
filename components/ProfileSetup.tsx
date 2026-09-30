"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type SetupProfile = {
  username: string;
  display_name: string;
  bio: string;
  avatar_emoji: string;
};

const STUDY_EMOJIS = ["📚","🧠","🎓","🔬","🧪","💡","✍️","🌱","🚀","🧩","📐","🩺"];

export default function ProfileSetup({
  session,
  onComplete,
}: {
  session: Session;
  onComplete: () => void;
}) {
  const emailLocal = String(session.user.email || "akun").split("@")[0] || "akun";
  const defaultUsername = useMemo(() => {
    const normalized = emailLocal.toLowerCase().replace(/[^a-z0-9._]/g, "").slice(0, 32);
    return normalized.length >= 3 ? normalized : "akun";
  }, [emailLocal]);

  const [username, setUsername] = useState(defaultUsername);
  const [displayName, setDisplayName] = useState(emailLocal);
  const [bio, setBio] = useState("");
  const [avatarEmoji, setAvatarEmoji] = useState("📚");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data } = await supabase
        .from("user_profiles")
        .select("username,display_name,bio,avatar_emoji")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (!alive) return;
      if (data) {
        setUsername(String(data.username || defaultUsername));
        setDisplayName(String(data.display_name || emailLocal));
        setBio(String(data.bio || ""));
        setAvatarEmoji(String(data.avatar_emoji || "📚"));
      }
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, [session.user.id, defaultUsername, emailLocal]);

  async function save() {
    const safeUsername = username
      .toLowerCase()
      .replace(/[^a-z0-9._]/g, "")
      .slice(0, 32);

    if (safeUsername.length < 3) {
      setErrorText("Username minimal 3 karakter.");
      return;
    }

    const safeName = displayName.trim().slice(0, 80);
    if (!safeName) {
      setErrorText("Isi nama profil terlebih dahulu.");
      return;
    }

    setBusy(true);
    setErrorText("");
    const { error } = await supabase
      .from("user_profiles")
      .update({
        username: safeUsername,
        display_name: safeName,
        bio: bio.trim().slice(0, 220),
        avatar_emoji: avatarEmoji || "📚",
        avatar_url: null,
        onboarding_completed: true,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", session.user.id);

    setBusy(false);
    if (error) {
      setErrorText(
        error.code === "23505"
          ? "Username ini sudah dipakai. Coba variasi lain."
          : error.message
      );
      return;
    }

    onComplete();
  }

  return (
    <main className="authShell profileSetupShell">
      <section className="authCard profileSetupCard">
        <div className="profileSetupBrandRow">
          <div className="brandMark">RB</div>
          <div>
            <p className="eyebrow">PROFIL BELAJAR</p>
            <strong>Siapkan identitas Ruang Belajar kamu</strong>
          </div>
        </div>

        <div className="profileSetupHero">
          <div className="profileSetupAvatar" aria-label={"Avatar " + avatarEmoji}>
            {avatarEmoji}
          </div>
          <div>
            <h1>{displayName || emailLocal}</h1>
            <p>@{username || defaultUsername}</p>
          </div>
        </div>

        <p className="muted profileSetupIntro">
          Profil ini menjadi halaman depan akunmu—tempat teman melihat identitas belajar,
          jumlah teman, dan Ruang Belajar yang kamu bagikan.
        </p>

        <div className="stack profileSetupFields">
          <label>
            Username
            <div className="socialUsernameInput">
              <span>@</span>
              <input
                autoFocus
                value={username}
                maxLength={32}
                onChange={(e) =>
                  setUsername(
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9._]/g, "")
                  )
                }
                placeholder={defaultUsername}
              />
            </div>
            <small className="muted">
              Kami isi otomatis dari email: <b>{defaultUsername}</b>. Kamu boleh menggantinya sekarang.
            </small>
          </label>

          <label>
            Nama profil
            <input
              value={displayName}
              maxLength={80}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Nama yang dilihat teman"
            />
          </label>

          <div className="profileEmojiField">
            <span className="profileEmojiLabel">Avatar belajar</span>
            <div className="profileEmojiGrid">
              {STUDY_EMOJIS.map((emoji) => (
                <button
                  type="button"
                  key={emoji}
                  className={avatarEmoji === emoji ? "profileEmojiChoice active" : "profileEmojiChoice"}
                  onClick={() => setAvatarEmoji(emoji)}
                  aria-label={"Pilih avatar " + emoji}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <small className="muted">Bisa diubah lagi kapan saja dari Edit profil.</small>
          </div>

          <label>
            Bio / fokus belajar <span className="muted">(opsional)</span>
            <textarea
              rows={3}
              value={bio}
              maxLength={220}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Contoh: Mahasiswa Farmasi · fokus farmakokinetik dan analisis kimia"
            />
            <small className="muted">{bio.length}/220</small>
          </label>

          {errorText && <div className="notice">{errorText}</div>}

          <button type="button" className="primary profileSetupContinue" disabled={busy || !loaded} onClick={() => void save()}>
            {busy ? "Menyimpan profil..." : loaded ? "Lanjut ke Ruang Belajar" : "Menyiapkan profil..."}
          </button>
        </div>
      </section>
    </main>
  );
}
