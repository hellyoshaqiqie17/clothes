"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MemberProfile } from "@/types/catalog";

interface AdminLoginGateProps {
  storeName: string;
  currentMember: MemberProfile | null;
}

export default function AdminLoginGate({
  storeName,
  currentMember,
}: AdminLoginGateProps) {
  const router = useRouter();
  const [signedInMember, setSignedInMember] = useState<MemberProfile | null>(
    currentMember
  );
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: identifier.trim(),
          password,
        }),
      });
      const data = (await res.json()) as {
        member?: MemberProfile;
        error?: string;
      };
      if (!res.ok || !data.member) {
        setErrorMsg(data.error || "Email/username atau password salah.");
        return;
      }

      setPassword("");
      if (data.member.role === "admin") {
        router.refresh();
        return;
      }

      // Logged in as regular member, not admin
      setSignedInMember(data.member);
      setErrorMsg(
        "Akun ini terdaftar sebagai Member biasa, bukan Admin. Gunakan akun Admin untuk mengakses dashboard."
      );
    } catch {
      setErrorMsg("Gangguan jaringan. Silakan coba beberapa saat lagi.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOutAndSwitch = async () => {
    setSigningOut(true);
    setErrorMsg(null);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // clear locally regardless
    } finally {
      setSignedInMember(null);
      setSigningOut(false);
      router.refresh();
    }
  };

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#FAFAFA] text-[#181817]">
      <header className="border-b border-[#E5E3DC] bg-white">
        <div className="mx-auto flex h-[68px] max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="font-display text-2xl font-medium tracking-tight text-[#181817]"
            >
              {storeName}
            </Link>
            <span className="border border-[#E5E3DC] bg-[#FAFAFA] px-2.5 py-0.5 text-[11px] font-medium text-[#57534E]">
              Admin Access
            </span>
          </div>
          <Link
            href="/"
            className="flex min-h-[42px] items-center border border-[#E5E3DC] bg-white px-4 text-xs font-medium text-[#181817] transition-colors hover:border-[#181817]"
          >
            Kembali ke Storefront
          </Link>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md border border-[#E5E3DC] bg-white p-6 shadow-sm sm:p-8">
          {signedInMember && signedInMember.role !== "admin" ? (
            <div className="space-y-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#881337]">
                  Akses Dibatasi
                </p>
                <h1 className="mt-1 font-display text-2xl font-normal tracking-tight text-[#181817]">
                  Halaman Khusus Admin
                </h1>
                <p className="mt-2 text-xs leading-relaxed text-[#57534E]">
                  Anda sedang login sebagai member{" "}
                  <strong className="font-medium text-[#181817]">
                    {signedInMember.email}
                  </strong>
                  . Dashboard ini hanya dapat diakses oleh akun dengan role{" "}
                  <strong className="font-medium text-[#181817]">Admin</strong>.
                </p>
              </div>

              {errorMsg && (
                <div
                  role="alert"
                  className="border border-[#881337] bg-[#FFF1F2] p-3 text-xs text-[#881337]"
                >
                  {errorMsg}
                </div>
              )}

              <div className="flex flex-col gap-2.5">
                <Link
                  href="/"
                  className="flex min-h-[46px] items-center justify-center bg-[#181817] px-4 text-xs font-medium tracking-wide text-white transition-colors hover:bg-[#333330]"
                >
                  Ke Halaman Toko
                </Link>
                <button
                  type="button"
                  disabled={signingOut}
                  onClick={() => void handleSignOutAndSwitch()}
                  className="min-h-[46px] border border-[#181817] bg-white px-4 text-xs font-medium text-[#181817] transition-colors hover:bg-[#F5F5F5] disabled:opacity-60"
                >
                  {signingOut
                    ? "Signing out..."
                    : "Sign Out & Login Akun Admin"}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#57534E]">
                  Unified Member &amp; Admin Login
                </p>
                <h1 className="mt-1 font-display text-2xl font-normal tracking-tight text-[#181817]">
                  Sign In ke {storeName} Admin
                </h1>
                <p className="mt-1.5 text-xs leading-relaxed text-[#57534E]">
                  Masuk menggunakan akun Admin Anda (username{" "}
                  <code className="font-mono text-[#181817]">admin</code> atau
                  email admin) untuk mengelola katalog, pesanan, pengiriman, dan
                  voucher.
                </p>
              </div>

              {errorMsg && (
                <div
                  role="alert"
                  className="border border-[#881337] bg-[#FFF1F2] p-3 text-xs text-[#881337]"
                >
                  {errorMsg}
                </div>
              )}

              <form onSubmit={(e) => void handleLogin(e)} className="space-y-4">
                <div>
                  <label
                    htmlFor="admin-login-identifier"
                    className="block text-xs font-medium text-[#181817]"
                  >
                    Email / Username *
                  </label>
                  <input
                    id="admin-login-identifier"
                    type="text"
                    required
                    autoComplete="username"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="admin atau admin@meridian.id"
                    className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs text-[#181817]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="admin-login-password"
                    className="block text-xs font-medium text-[#181817]"
                  >
                    Password *
                  </label>
                  <input
                    id="admin-login-password"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Masukkan password admin"
                    className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs text-[#181817]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[48px] w-full bg-[#181817] px-4 text-xs font-medium tracking-wide text-white transition-colors hover:bg-[#333330] disabled:opacity-60"
                >
                  {submitting ? "Memverifikasi..." : "Sign In ke Dashboard Admin"}
                </button>
              </form>

              <p className="border-t border-[#E5E3DC] pt-4 text-[11px] text-[#57534E]">
                Anda juga bisa login langsung melalui panel Member di halaman
                utama — akun ber-role Admin akan diarahkan otomatis ke halaman
                ini.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
