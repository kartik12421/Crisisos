// Native storage (Metro auto-picks index.web.ts on web — do NOT add Platform.OS checks).
//
// Import the ready-made singleton BY NAME and call methods on it — never a default
// import, never the methods bare:
//   import { storage } from "@/src/utils/storage";
//   await storage.getItem(key, fallback);      // the `fallback` arg is REQUIRED
//
// Namespaces: general KV -> getItem/setItem/removeItem (AsyncStorage);
//             tokens/secrets -> secureGet/secureSet/secureRemove (Keychain).
// Values are auto JSON-serialized (string|number|boolean|null) in this implementation — never JSON.stringify/parse yourself.
// Helpers NEVER throw: a miss returns `fallback`, a failed write returns `false` (failures are SILENT).
// 
// Use async/await for all storage operations.
//
// AUTH TOKENS: use ONE namespace (secure*) + ONE shared key constant, and read/write it the SAME
// way on both sides — the login/AuthContext (write) and the API client/interceptor (read). A
// mismatched method or key silently returns the fallback, surfacing as a logged-out state or 401/403
// with no error in the logs.

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

import { AssertNoExtras, StorageBase, StorageItemValue } from "./storage-base";

export class Storage extends StorageBase {
  // General KV — backed by AsyncStorage.
  // `fallback` is required and returned on any miss/parse error — a missing key looks identical to a stored `null`.
  async getItem<Fallback extends StorageItemValue>(
    key: string,
    fallback: Fallback,
  ): Promise<Fallback | null> {
    try {
      const raw = await AsyncStorage.getItem(key);
      return this.retrieve(raw, fallback);
    } catch (e) {
      this.warn("getItem", key, e);
      return fallback;
    }
  }

  async setItem<Value extends StorageItemValue>(
    key: string,
    value: Value,
  ): Promise<boolean> {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      this.warn("setItem", key, e);
      return false;
    }
  }

  async removeItem(key: string): Promise<boolean> {
    try {
      await AsyncStorage.removeItem(key);
      return true;
    } catch (e) {
      this.warn("removeItem", key, e);
      return false;
    }
  }

  // Sensitive values — Keychain (iOS) / EncryptedSharedPreferences (Android).
  // Use these (not getItem) for auth tokens; whatever writes with secureSet must read with secureGet under the same key.
  async secureGet<Fallback extends StorageItemValue>(
    key: string,
    fallback: Fallback,
  ): Promise<Fallback | null> {
    try {
      const raw = await SecureStore.getItemAsync(key);
      return this.retrieve(raw, fallback);
    } catch (e) {
      this.warn("secureGet", key, e);
      return fallback;
    }
  }

  async secureSet<Value extends StorageItemValue>(
    key: string,
    value: Value,
  ): Promise<boolean> {
    try {
      await SecureStore.setItemAsync(key, JSON.stringify(value));
      return true;
    } catch (e) {
      this.warn("secureSet", key, e);
      return false;
    }
  }

  async secureRemove(key: string): Promise<boolean> {
    try {
      await SecureStore.deleteItemAsync(key);
      return true;
    } catch (e) {
      this.warn("secureRemove", key, e);
      return false;
    }
  }
}

// The shared singleton — import THIS (`import { storage } from "@/src/utils/storage"`). Do not `new Storage()`.
export const storage = new Storage();

// Compile-time guard: any new method must be declared in storage-base.ts first.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- intentional compile-time-only assertion
type _NoExtras = AssertNoExtras<Exclude<keyof Storage, keyof StorageBase>>;