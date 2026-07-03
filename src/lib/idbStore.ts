// IndexedDB 持久化:存大体积内容(上传的图片 base64),连整页刷新都不丢。
// localStorage 有 ~5MB 配额、塞不下图片;IndexedDB 配额大得多。异步读写。
const DB_NAME = 'gw_workshop'
const STORE = 'kv'
let dbp: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  if (dbp) return dbp
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbp
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    const d = await db()
    return await new Promise<T | undefined>((resolve) => {
      const r = d.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      r.onsuccess = () => resolve(r.result as T)
      r.onerror = () => resolve(undefined)
    })
  } catch {
    return undefined
  }
}

export async function idbSet(key: string, val: unknown): Promise<void> {
  try {
    const d = await db()
    await new Promise<void>((resolve) => {
      const r = d.transaction(STORE, 'readwrite').objectStore(STORE).put(val, key)
      r.onsuccess = () => resolve()
      r.onerror = () => resolve()
    })
  } catch {
    /* ignore */
  }
}
