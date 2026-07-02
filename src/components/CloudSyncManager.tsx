import { useEffect } from "react";
import { useAuth } from "../lib/auth";
import { useSubscription } from "../lib/subscription";
import { fullSync, startAutoSync } from "../lib/cloudSync";

/**
 * Mounts once at the app root. When a Pro user is signed in, it does an initial
 * full sync and then keeps the cloud mirrored to local edits. No-op otherwise.
 */
export function CloudSyncManager() {
  const { user } = useAuth();
  const { isPro } = useSubscription();

  useEffect(() => {
    if (!user || !isPro) return;
    let stop = () => {};
    let cancelled = false;
    fullSync(user.id)
      .catch(() => {})
      .finally(() => {
        if (!cancelled) stop = startAutoSync(user.id);
      });
    return () => {
      cancelled = true;
      stop();
    };
  }, [user, isPro]);

  return null;
}
