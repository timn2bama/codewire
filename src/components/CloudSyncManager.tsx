import { useEffect } from "react";
import { useAuth } from "../lib/auth";
import { useSubscription } from "../lib/subscription";
import { createSyncController } from "../lib/cloudSync";
import {
  activateSyncStatus,
  markSyncError,
  markSyncPending,
  markSyncing,
  markSyncSuccess,
  registerSyncRetry,
  setLocalOnlyStatus,
} from "../lib/syncStatus";

/** Mounts the single serialized Pro cloud-sync session for the active user. */
export function CloudSyncManager() {
  const { user, loading: authLoading } = useAuth();
  const { isPro } = useSubscription();
  const userId = user?.id;

  useEffect(() => {
    if (authLoading) return;

    if (!userId || !isPro) {
      setLocalOnlyStatus();
      return;
    }

    activateSyncStatus(userId);
    const controller = createSyncController(userId, {
      onPending: markSyncPending,
      onStart: markSyncing,
      onSuccess: () => markSyncSuccess(),
      onError: markSyncError,
    });
    registerSyncRetry(controller.retry);
    void controller.initialSync().catch(() => {
      // The recovery UI exposes the failure and owns the manual retry path.
    });

    return () => {
      registerSyncRetry(null);
      controller.stop();
    };
  }, [authLoading, userId, isPro]);

  return null;
}
