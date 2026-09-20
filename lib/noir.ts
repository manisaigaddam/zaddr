"use client";

import { detectProvider, getNoirWallet, type NoirWalletProvider, type ZcashConnectResult } from "@noir-wallet/sdk";

const KEY = "zaddr.playerKey";
export const PLAYER_KEY = KEY;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function raw() {
  if (typeof window === "undefined") return null;
  const w = window as Window & { noirwallet?: { zcash?: unknown }; NoirWallet?: { zcash?: unknown } };
  return w.noirwallet || w.NoirWallet || null;
}

function readStored() {
  try {
    const local = localStorage.getItem(KEY);
    if (local) return local;
    const ses = sessionStorage.getItem(KEY);
    if (ses) {
      localStorage.setItem(KEY, ses);
      sessionStorage.removeItem(KEY);
      return ses;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function waitForNoir(timeout = 8000): Promise<NoirWalletProvider | null> {
  const start = Date.now();
  void detectProvider(timeout).catch(() => null);
  while (Date.now() - start < timeout) {
    const sdk = getNoirWallet();
    if (sdk?.zcash) return sdk;
    if (raw()?.zcash) {
      const again = getNoirWallet();
      if (again?.zcash) return again;
    }
    await sleep(120);
  }
  return getNoirWallet();
}

export async function hashSeat(material: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("zaddr-ttt|" + material));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function keyFromConnection(connection: ZcashConnectResult) {
  const material = String(connection.accounts?.[0]?.id || connection.shielded || "").trim();
  if (!material) throw new Error("Noir returned no account.");
  const key = await hashSeat(material);
  localStorage.setItem(KEY, key);
  return key;
}

/** Silent restore — getAccounts() first, never a popup. Stored key covers refresh. */
export async function restoreNoir(): Promise<{ key: string | null; installed: boolean }> {
  const stored = readStored();
  const wallet = await waitForNoir(stored ? 2500 : 8000);
  if (!wallet) return { key: stored, installed: false };
  try {
    const existing = await wallet.zcash.getAccounts();
    if (existing) return { key: await keyFromConnection(existing), installed: true };
  } catch {
    /* keep stored */
  }
  return { key: stored, installed: true };
}

export async function connectNoir(): Promise<string> {
  const wallet = await waitForNoir(2000);
  if (!wallet) throw new Error("Noir isn’t on this page. Open http://localhost:3000 in Chrome with the extension.");
  const existing = await wallet.zcash.getAccounts();
  if (existing) return keyFromConnection(existing);
  const connection = await wallet.zcash.connect();
  return keyFromConnection(connection);
}

export function watchNoir(onChange: (key: string | null) => void) {
  const wallet = getNoirWallet();
  if (!wallet) return () => {};
  const handler = () => {
    void (async () => {
      const acc = await wallet.zcash.getAccounts();
      if (!acc) {
        localStorage.removeItem(KEY);
        onChange(null);
        return;
      }
      onChange(await keyFromConnection(acc));
    })();
  };
  wallet.zcash.on("accountsChanged", handler);
  return () => wallet.zcash.removeListener("accountsChanged", handler);
}
