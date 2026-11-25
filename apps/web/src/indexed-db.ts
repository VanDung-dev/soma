export function openIndexedDatabase(name: string, version: number, upgrade: (db: IDBDatabase) => void,
  options?: { closeOnVersionChange: boolean; blockedMessage: string }) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => {
      const db = request.result;
      if (options?.closeOnVersionChange) db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    if (options) request.onblocked = () => reject(new Error(options.blockedMessage));
  });
}

export function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error);
  });
}
