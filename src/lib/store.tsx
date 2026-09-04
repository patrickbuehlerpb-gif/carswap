"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { seedDeals } from "./data/deals";
import { CURRENT_USER_ID } from "./data/users";
import type { Deal, DealMessage, DealStatus } from "./types";

const STORAGE_KEY = "carswap.state.v1";

interface PersistedState {
  deals: Deal[];
  watchlist: string[];
}

interface StoreValue extends PersistedState {
  /** true, sobald der Zustand aus dem Browser-Speicher übernommen wurde */
  hydrated: boolean;
  createDeal(input: {
    fromVehicleId: string;
    toVehicleId: string;
    counterpartyId: string;
    cashDelta: number;
    message: string;
  }): Deal;
  addMessage(dealId: string, text: string, offerCash?: number): void;
  setDealStatus(dealId: string, status: DealStatus): void;
  toggleWatch(listingId: string): void;
  reset(): void;
}

const StoreContext = createContext<StoreValue | null>(null);

function initialState(): PersistedState {
  return { deals: seedDeals, watchlist: ["l-002", "l-007"] };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PersistedState>(initialState);
  const [hydrated, setHydrated] = useState(false);

  // Erst nach dem ersten Render aus localStorage laden — sonst weicht das
  // Client-Markup vom Server-Markup ab.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PersistedState;
        if (Array.isArray(parsed.deals) && Array.isArray(parsed.watchlist)) {
          setState(parsed);
        }
      }
    } catch {
      // beschädigter Speicher: mit dem Startzustand weiterarbeiten
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Speicher voll oder gesperrt — nicht kritisch für die Demo
    }
  }, [state, hydrated]);

  const createDeal = useCallback<StoreValue["createDeal"]>((input) => {
    const deal: Deal = {
      id: `d-${Math.random().toString(36).slice(2, 8)}`,
      fromVehicleId: input.fromVehicleId,
      toVehicleId: input.toVehicleId,
      initiatorId: CURRENT_USER_ID,
      counterpartyId: input.counterpartyId,
      cashDelta: input.cashDelta,
      status: "vorschlag",
      createdAt: new Date().toISOString().slice(0, 10),
      messages: [
        {
          id: `m-${Math.random().toString(36).slice(2, 8)}`,
          authorId: CURRENT_USER_ID,
          at: new Date().toISOString(),
          text: input.message,
          offerCash: input.cashDelta,
        },
      ],
    };
    setState((s) => ({ ...s, deals: [deal, ...s.deals] }));
    return deal;
  }, []);

  const addMessage = useCallback<StoreValue["addMessage"]>((dealId, text, offerCash) => {
    const msg: DealMessage = {
      id: `m-${Math.random().toString(36).slice(2, 8)}`,
      authorId: CURRENT_USER_ID,
      at: new Date().toISOString(),
      text,
      offerCash,
    };
    setState((s) => ({
      ...s,
      deals: s.deals.map((d) =>
        d.id === dealId
          ? {
              ...d,
              messages: [...d.messages, msg],
              cashDelta: offerCash ?? d.cashDelta,
              status: d.status === "vorschlag" ? "verhandlung" : d.status,
            }
          : d,
      ),
    }));
  }, []);

  const setDealStatus = useCallback<StoreValue["setDealStatus"]>((dealId, status) => {
    setState((s) => ({
      ...s,
      deals: s.deals.map((d) => (d.id === dealId ? { ...d, status } : d)),
    }));
  }, []);

  const toggleWatch = useCallback<StoreValue["toggleWatch"]>((listingId) => {
    setState((s) => ({
      ...s,
      watchlist: s.watchlist.includes(listingId)
        ? s.watchlist.filter((x) => x !== listingId)
        : [...s.watchlist, listingId],
    }));
  }, []);

  const reset = useCallback(() => setState(initialState()), []);

  const value = useMemo<StoreValue>(
    () => ({ ...state, hydrated, createDeal, addMessage, setDealStatus, toggleWatch, reset }),
    [state, hydrated, createDeal, addMessage, setDealStatus, toggleWatch, reset],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore muss innerhalb von <StoreProvider> verwendet werden");
  return ctx;
}
