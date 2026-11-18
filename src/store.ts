// 歷史紀錄：存在這台裝置的 IndexedDB（原圖＋模型＋縮圖），最多保留 40 筆
import type { Plan } from './plan';

export interface Project {
  id: string;
  name: string;
  time: number;
  thumb: string;
  plan: Plan;
  image: string;
  imageName: string;
}

const DB = 'xiaoke-floorplan';
const ST = 'projects';
const MAX = 40;

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(ST, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(ST, mode);
    const req = fn(t.objectStore(ST));
    t.oncomplete = () => {
      db.close();
      res(req.result);
    };
    t.onerror = () => {
      db.close();
      rej(t.error);
    };
  });
}

export async function put(p: Omit<Project, 'id'> & { id?: string }): Promise<string> {
  const id = p.id ?? `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await tx('readwrite', (s) => s.put({ ...p, id }));
  const all = await list();
  for (const old of all.slice(MAX)) await remove(old.id);
  return id;
}

export async function list(): Promise<Project[]> {
  const all = await tx<Project[]>('readonly', (s) => s.getAll() as IDBRequest<Project[]>);
  return all.sort((a, b) => b.time - a.time);
}

export const get = (id: string) => tx<Project | undefined>('readonly', (s) => s.get(id) as IDBRequest<Project | undefined>);
export const remove = (id: string) => tx('readwrite', (s) => s.delete(id));
