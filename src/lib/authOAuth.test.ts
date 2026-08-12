import { describe, expect, it, vi } from "vitest";
import { getSafeAuthReturnPath, startGoogleOAuth } from "./authOAuth";

describe("Google OAuth return handling", () => {
  it("passes the exact checkout confirmation return to Supabase", async () => {
    const signInWithOAuth = vi.fn().mockResolvedValue({ error: null });

    await startGoogleOAuth(
      { signInWithOAuth },
      "https://codewire.tools",
      "/account?upgraded=1",
    );

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "https://codewire.tools/account?upgraded=1",
      },
    });
  });

  it("preserves the upgrade return and rejects untrusted targets", async () => {
    expect(getSafeAuthReturnPath("/upgrade")).toBe("/upgrade");
    expect(getSafeAuthReturnPath("https://evil.example/account")).toBe(
      "/account",
    );
    expect(getSafeAuthReturnPath("//evil.example/account")).toBe("/account");

    const signInWithOAuth = vi.fn().mockResolvedValue({ error: null });
    await startGoogleOAuth(
      { signInWithOAuth },
      "https://codewire.tools",
      "https://evil.example/account",
    );

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "https://codewire.tools/account" },
    });
  });

  it("returns Supabase OAuth errors to the account UI", async () => {
    const signInWithOAuth = vi.fn().mockResolvedValue({
      error: { message: "Google sign-in is unavailable." },
    });

    await expect(
      startGoogleOAuth({ signInWithOAuth }, "https://codewire.tools"),
    ).resolves.toEqual({ error: "Google sign-in is unavailable." });
  });
});
