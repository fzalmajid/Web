"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { ProfileEditorPanel, type UserProfile } from "@/components/ProfileHome";

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

  const fallback = useMemo<UserProfile>(() => ({
    user_id: session.user.id,
    username: defaultUsername,
    display_name: emailLocal,
    bio: "",
    avatar_url: String(
      session.user.user_metadata?.avatar_url ||
      session.user.user_metadata?.picture ||
      ""
    ) || null,
    avatar_emoji: "📚",
    avatar_bg_color: "#10231d",
    onboarding_completed: false,
    auto_accept_friends: false,
    last_active_at: null,
  }), [session.user.id, session.user.user_metadata, defaultUsername, emailLocal]);

  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data, error } = await supabase
        .from("user_profiles")
        .select("*")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (!alive) return;

      if (!error && data) {
        setProfile(data as UserProfile);
        return;
      }

      const { data: created } = await supabase
        .from("user_profiles")
        .upsert({
          user_id: fallback.user_id,
          username: fallback.username,
          display_name: fallback.display_name,
          bio: "",
          avatar_url: fallback.avatar_url,
          avatar_emoji: fallback.avatar_emoji,
          avatar_bg_color: fallback.avatar_bg_color,
          onboarding_completed: false,
          auto_accept_friends: false,
        }, { onConflict: "user_id" })
        .select("*")
        .single();

      if (alive) setProfile((created as UserProfile | null) || fallback);
    })();

    return () => { alive = false; };
  }, [session.user.id, fallback]);

  return (
    <main className="authShell profileSetupShell">
      <section className="authCard profileSetupCard profileSetupCardUnified">
        <div className="sheetHead profileSetupHead">
          <div>
            <p className="eyebrow">PROFIL</p>
            <h2>Buat profil</h2>
          </div>
          <span className="brandMini" aria-hidden="true">RB</span>
        </div>

        {profile ? (
          <ProfileEditorPanel
            profile={profile}
            submitLabel="Buat profil"
            onSaved={onComplete}
          />
        ) : (
          <div className="profileSetupLoading">Menyiapkan profil...</div>
        )}
      </section>
    </main>
  );
}
