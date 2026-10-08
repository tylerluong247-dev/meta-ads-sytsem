import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptToken, encryptToken } from "./crypto";

/** Encrypted provider tokens. Only the server can read these; they never reach the browser or the client-facing tables. */
export interface SecretStore {
  get(workspaceId: string, integrationId: string): Promise<string | null>;
  set(workspaceId: string, integrationId: string, plaintext: string): Promise<void>;
}

export class MemorySecretStore implements SecretStore {
  private m = new Map<string, string>();
  constructor(private readonly keyHex: string) {}
  async get(_ws: string, id: string) {
    const v = this.m.get(id);
    return v ? decryptToken(v, this.keyHex) : null;
  }
  async set(_ws: string, id: string, plaintext: string) {
    this.m.set(id, encryptToken(plaintext, this.keyHex));
  }
}

export class SupabaseSecretStore implements SecretStore {
  constructor(private readonly serviceDb: SupabaseClient, private readonly keyHex: string) {}
  async get(workspaceId: string, integrationId: string) {
    const { data, error } = await this.serviceDb.from("integration_secrets").select("encrypted_token").eq("workspace_id", workspaceId).eq("integration_id", integrationId).maybeSingle();
    if (error) throw new Error(`integration_secrets: ${error.message}`);
    return data ? decryptToken(data.encrypted_token as string, this.keyHex) : null;
  }
  async set(workspaceId: string, integrationId: string, plaintext: string) {
    const { error } = await this.serviceDb.from("integration_secrets").upsert({ integration_id: integrationId, workspace_id: workspaceId, encrypted_token: encryptToken(plaintext, this.keyHex), updated_at: new Date().toISOString() });
    if (error) throw new Error(`integration_secrets: ${error.message}`);
  }
}
