import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "@/lib/api-base";

export interface MySettings {
  client: { id: number; name: string; company: string | null; plan: string };
  lemlist: { hasApiKey: boolean; keyHint: string | null; usingGlobalFallback: boolean };
  webhook: {
    url: string | null;
    hasSecret: boolean;
    headerName: string;
    /** Same secret, per lead source. Absent from servers older than Meta/WhatsApp support. */
    metaUrl?: string | null;
    whatsappUrl?: string | null;
    googleUrl?: string | null;
    youtubeUrl?: string | null;
  };
  whatsapp?: { phoneNumberId: string | null; hasAccessToken: boolean; tokenHint: string | null };
  slack: { channel: string | null };
  usage: {
    activeCampaigns: number;
    activeCampaignLimit: number;
    totalCampaigns: number;
    repliesThisMonth: number;
    replyLimit: number;
  };
}

export interface LemlistCampaignOption {
  id: string;
  name: string;
  mapped: boolean;
}

const KEY = ["me", "settings"] as const;

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

export function useMySettings() {
  return useQuery<MySettings>({
    queryKey: KEY,
    queryFn: async () => json<MySettings>(await fetch(`${API_BASE}/api/me/settings`, { credentials: "include" })),
    retry: false,
  });
}

export function useUpdateMySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      lemlistApiKey?: string;
      slackChannel?: string | null;
      whatsappPhoneNumberId?: string;
      whatsappAccessToken?: string;
    }) =>
      json<MySettings>(await fetch(`${API_BASE}/api/me/settings`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })),
    onSuccess: (data) => qc.setQueryData(KEY, data),
  });
}

export function useTestLemlist() {
  return useMutation({
    mutationFn: async () =>
      json<{ ok: boolean; error?: string }>(await fetch(`${API_BASE}/api/me/settings/lemlist/test`, {
        method: "POST",
        credentials: "include",
      })),
  });
}

export function useRegenerateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      json<MySettings>(await fetch(`${API_BASE}/api/me/settings/webhook/regenerate`, {
        method: "POST",
        credentials: "include",
      })),
    onSuccess: (data) => qc.setQueryData(KEY, data),
  });
}

/**
 * The client's real Lemlist campaigns. Disabled until a key is saved — without
 * one the endpoint can only answer 503, and firing it anyway would show the
 * client an error they already know the reason for.
 */
export function useLemlistCampaignOptions(enabled: boolean) {
  return useQuery<LemlistCampaignOption[]>({
    queryKey: ["me", "lemlist-campaigns"],
    enabled,
    retry: false,
    queryFn: async () => {
      const body = await json<{ campaigns: LemlistCampaignOption[] }>(
        await fetch(`${API_BASE}/api/me/lemlist/campaigns`, { credentials: "include" }),
      );
      return body.campaigns;
    },
  });
}
