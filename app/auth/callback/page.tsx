"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { finishAuthCallback } from "@/lib/authSessionBootstrap";

// Importing the shared client initializes the managed SDK's popup callback.
// Its verifier exchange and opener message remain owned by the provider.
export default function AuthCallback() {
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void finishAuthCallback(window.location.search, () => supabase.auth.getSession()).then((result) => {
      if (!active || result.status === "popup") return;
      if (result.status === "ready") window.location.replace("/");
      else setError(result.error);
    });
    return () => { active = false; };
  }, []);

  return (
    <main className="authShell">
      <section className="authCard">
        <div className="brandMark">RB</div>
        <h1>{error ? "Login belum selesai" : "Menyelesaikan login"}</h1>
        <p className="muted" role={error ? "alert" : "status"}>
          {error || "Anda akan kembali ke Ruang Belajar setelah akun terhubung."}
        </p>
        <a className="textBtn" href="/">Kembali ke Ruang Belajar</a>
      </section>
    </main>
  );
}
