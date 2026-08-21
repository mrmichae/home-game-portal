import { useEffect, useState } from "react";
import type { CatalogCollection, GameSummary } from "../domain/types";
import { api } from "./api";

export function useCatalog(): { games: GameSummary[]; collections: CatalogCollection[]; loading: boolean; message: string | null } {
  const [games, setGames] = useState<GameSummary[]>([]);
  const [collections, setCollections] = useState<CatalogCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    void api.catalog()
      .then((catalog) => { setGames(catalog.shelf.games); setCollections(catalog.presentation.collections); setMessage(null); })
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "The library could not be loaded."))
      .finally(() => setLoading(false));
  }, []);
  return { games, collections, loading, message };
}
