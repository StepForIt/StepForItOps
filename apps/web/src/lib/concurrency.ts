/**
 * Exécute au plus `limit` tâches en parallèle (assez pour un run de masse, sans ouvrir
 * 60 analyses d'un coup). `onDone` est appelé dans l'ordre des fins, pas celui de la liste.
 */
export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
  onDone?: () => void,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++];
      try {
        await task(item);
      } finally {
        onDone?.();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
