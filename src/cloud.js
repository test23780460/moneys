import { createClient } from "@supabase/supabase-js";
import { freshState, loadSyncBase, saveSyncBase, validateBackup } from "./storage.js";
import { hasFinancialData, mergeImport, mergeStates, same } from "./merge.js";

export const cloudEnabled = Boolean(__SUPABASE_URL__ && __SUPABASE_KEY__);
export const cloud = cloudEnabled
  ? createClient(__SUPABASE_URL__, __SUPABASE_KEY__, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
    })
  : null;

const equal = same;

export class BudgetSync {
  constructor(userId, { getState, applyState, setStatus, onConflict }) {
    this.userId = userId;
    this.getState = getState;
    this.applyState = applyState;
    this.setStatus = setStatus;
    this.onConflict = onConflict;
    this.base = loadSyncBase(userId);
    this.running = false;
    this.again = false;
    this.stopped = false;
    this.conflict = null;
    this.lastSynced = null;
    this.online = () => this.queue();
  }

  async start() {
    window.addEventListener("online", this.online);
    this.channel = cloud
      .channel(`budget-${this.userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "budget_documents", filter: `user_id=eq.${this.userId}` },
        () => this.queue(),
      )
      .subscribe();
    this.poll = setInterval(() => this.queue(), 30000);
    await this.queue();
  }

  stop() {
    this.stopped = true;
    clearInterval(this.poll);
    window.removeEventListener("online", this.online);
    if (this.channel) void cloud.removeChannel(this.channel);
  }

  localChanged() {
    this.setStatus(navigator.onLine ? "Saving" : "Offline");
    this.queue();
  }

  async readRemote() {
    const { data, error } = await cloud
      .from("budget_documents")
      .select("revision,data,updated_at")
      .eq("user_id", this.userId)
      .maybeSingle();
    if (error) throw error;
    if (data) validateBackup(data.data);
    return data || { revision: 0, data: freshState(), updated_at: null };
  }

  async queue() {
    if (this.stopped || this.conflict) return;
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    do {
      this.again = false;
      try {
        if (!navigator.onLine) {
          this.setStatus("Offline");
          break;
        }
        await this.reconcile();
      } catch (error) {
        console.error("Budget sync failed", error);
        this.setStatus("Sync error", error.message || "Cloud save failed");
        break;
      }
    } while (this.again && !this.stopped && !this.conflict);
    this.running = false;
  }

  async reconcile(preference = null) {
    const remote = await this.readRemote();
    let local = structuredClone(this.getState());
    let merged;
    if (!this.base) {
      if (remote.revision && hasFinancialData(local)) {
        // A cache without a known base cannot be merged safely.
        this.conflict = { remote, local, firstConnection: true };
        this.setStatus("Sync conflict");
        this.onConflict(["unverified local cache"]);
        return;
      }
      merged = remote.revision ? remote.data : local;
    } else {
      const result = mergeStates(this.base.state, local, remote.data, preference);
      if (result.conflicts.length && !preference) {
        this.conflict = { remote, local };
        this.setStatus("Sync conflict");
        this.onConflict(result.conflicts);
        return;
      }
      merged = result.state;
    }
    if (this.stopped) return;
    if (!equal(this.getState(), local)) {
      this.again = true;
      return;
    }
    if (!equal(merged, local)) await this.applyState(merged);
    if (equal(merged, remote.data) && remote.revision) {
      this.recordBase(remote.revision, remote.data, remote.updated_at);
      if (equal(this.getState(), remote.data)) this.setStatus("Synced");
      else this.again = true;
      return;
    }
    this.setStatus("Saving");
    const { data: revision, error } = await cloud.rpc("save_budget_document", {
      expected_revision: remote.revision,
      next_data: merged,
    });
    if (error) {
      if (error.code === "40001" || error.message?.includes("revision_conflict")) {
        this.again = true;
        return;
      }
      throw error;
    }
    this.recordBase(Number(revision), merged, new Date().toISOString());
    if (equal(this.getState(), merged)) this.setStatus("Synced");
    else {
      this.setStatus("Saving");
      this.again = true;
    }
  }

  recordBase(revision, state, timestamp) {
    this.base = { revision, state: structuredClone(state) };
    saveSyncBase(this.userId, revision, state);
    this.lastSynced = timestamp;
  }

  async resolve(choice) {
    if (!this.conflict) return;
    const conflict = this.conflict;
    this.conflict = null;
    if (conflict.firstConnection) {
      if (choice === "remote") await this.applyState(conflict.remote.data);
      this.recordBase(conflict.remote.revision, conflict.remote.data, conflict.remote.updated_at);
    }
    await this.reconcile(choice);
    await this.queue();
  }

  // The caller verifies the remote result before marking the legacy guest import.
  async importLegacy(legacyState) {
    if (this.conflict) throw Error("Resolve the sync conflict before importing.");
    if (!this.base || !equal(this.getState(), this.base.state))
      throw Error("Finish syncing this account's pending edits before importing local data.");
    for (let attempt = 0; attempt < 3; attempt++) {
      const remote = await this.readRemote();
      if (remote.revision !== this.base.revision)
        throw Error("Cloud data changed. Sync this account and retry the import.");
      const { state: nextState, counts } = mergeImport(legacyState, remote.data);
      if (equal(nextState, remote.data)) {
        this.recordBase(remote.revision, remote.data, remote.updated_at);
        return counts;
      }
      const { data: revision, error } = await cloud.rpc("save_budget_document", {
        expected_revision: remote.revision,
        next_data: nextState,
      });
      if (error?.code === "40001" || error?.message?.includes("revision_conflict"))
        continue;
      if (error) throw error;
      const check = await this.readRemote();
      if (Number(revision) !== check.revision || !equal(check.data, nextState))
        throw Error("Cloud verification failed; local data is still intact.");
      this.recordBase(check.revision, check.data, check.updated_at);
      await this.applyState(check.data);
      this.setStatus("Synced");
      return counts;
    }
    throw Error("Cloud data changed during import. Try again.");
  }
}
