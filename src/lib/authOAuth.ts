const ALLOWED_AUTH_RETURN_PATHS = new Set([
  "/account?upgraded=1",
  "/upgrade",
]);

interface GoogleOAuthClient {
  signInWithOAuth(credentials: {
    provider: "google";
    options: { redirectTo: string };
  }): Promise<{ error: { message: string } | null }>;
}

export function getSafeAuthReturnPath(
  requestedPath: string | null | undefined,
): string {
  return requestedPath && ALLOWED_AUTH_RETURN_PATHS.has(requestedPath)
    ? requestedPath
    : "/account";
}

export async function startGoogleOAuth(
  auth: GoogleOAuthClient,
  origin: string,
  requestedPath?: string | null,
): Promise<{ error?: string }> {
  const redirectTo = new URL(getSafeAuthReturnPath(requestedPath), origin).href;
  const { error } = await auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
  return { error: error?.message };
}
