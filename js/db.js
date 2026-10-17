// @ts-check
/**
 * IndexedDB ストレージ層（プライベートブラウズ等でIndexedDBが使用不能な場合はインメモリへ安全にフォールバック）
 */
import { DEFAULT_SUBJECTS } from './models.js';

const DB_NAME = 'SmartLectureNoteDB';
const DB_VERSION = 1;

const STORE_SUBJECTS = 'subjects';
const STORE_DOCUMENTS = 'documents';
const STORE_SETTINGS = 'settings';

/** @type {IDBDatabase | null} */
let dbInstance = null;
let useMemoryFallback = false;

const memoryStore = {
  /** @type {Map<string, any>} */
  subjects: new Map(),
  /** @type {Map<string, any>} */
  documents: new Map(),
  /** @type {Map<string, any>} */
  settings: new Map(),
};

/**
 * データベースを初期化して接続を返す
 * @returns {Promise<IDBDatabase | null>}
 */
export async function initDB() {
  if (dbInstance) return dbInstance;
  if (useMemoryFallback) return null;

  if (typeof indexedDB === 'undefined') {
    useMemoryFallback = true;
    await ensureDefaultSubjects();
    return null;
  }

  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (event) => {
        const db = /** @type {IDBOpenDBRequest} */ (event.target).result;
        if (!db.objectStoreNames.contains(STORE_SUBJECTS)) {
          db.createObjectStore(STORE_SUBJECTS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_DOCUMENTS)) {
          const docStore = db.createObjectStore(STORE_DOCUMENTS, { keyPath: 'id' });
          docStore.createIndex('subjectId', 'subjectId', { unique: false });
          docStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
          db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
        }
      };

      req.onsuccess = async () => {
        dbInstance = req.result;
        await ensureDefaultSubjects();
        resolve(dbInstance);
      };

      req.onerror = async () => {
        console.warn('IndexedDB unavailable, falling back to memory store');
        useMemoryFallback = true;
        await ensureDefaultSubjects();
        resolve(null);
      };
    } catch (err) {
      console.warn('IndexedDB exception, falling back to memory store:', err);
      useMemoryFallback = true;
      ensureDefaultSubjects().then(() => resolve(null));
    }
  });
}

/**
 * 初期教科フォルダが存在しない場合に投入する
 */
async function ensureDefaultSubjects() {
  const existing = await getAllSubjects();
  if (existing.length === 0) {
    for (const subj of DEFAULT_SUBJECTS) {
      await saveSubject(subj);
    }
  }
}

/**
 * 教科一覧を取得する
 * @returns {Promise<Array<any>>}
 */
export async function getAllSubjects() {
  await initDB();
  if (useMemoryFallback || !dbInstance) {
    return Array.from(memoryStore.subjects.values());
  }
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(STORE_SUBJECTS, 'readonly');
    const store = tx.objectStore(STORE_SUBJECTS);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * 教科を保存・追加する
 * @param {any} subject
 * @returns {Promise<void>}
 */
export async function saveSubject(subject) {
  if (!subject || !subject.id) throw new Error('Invalid subject');
  if (!dbInstance && !useMemoryFallback) {
    await initDB();
  }
  if (useMemoryFallback || !dbInstance) {
    memoryStore.subjects.set(subject.id, { ...subject });
    return;
  }
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(STORE_SUBJECTS, 'readwrite');
    const store = tx.objectStore(STORE_SUBJECTS);
    const req = store.put(subject);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * 教科を削除する
 * @param {string} subjectId
 * @returns {Promise<void>}
 */
export async function deleteSubject(subjectId) {
  await initDB();
  if (useMemoryFallback || !dbInstance) {
    memoryStore.subjects.delete(subjectId);
    return;
  }
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(STORE_SUBJECTS, 'readwrite');
    const store = tx.objectStore(STORE_SUBJECTS);
    const req = store.delete(subjectId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * 全ドキュメントを更新日時降順で取得する
 * @returns {Promise<Array<any>>}
 */
export async function getAllDocuments() {
  await initDB();
  if (useMemoryFallback || !dbInstance) {
    return Array.from(memoryStore.documents.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(STORE_DOCUMENTS, 'readonly');
    const store = tx.objectStore(STORE_DOCUMENTS);
    const req = store.getAll();
    req.onsuccess = () => {
      const list = req.result || [];
      list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * 指定IDのドキュメントを取得する
 * @param {string} docId
 * @returns {Promise<any | null>}
 */
export async function getDocumentById(docId) {
  await initDB();
  if (useMemoryFallback || !dbInstance) {
    return memoryStore.documents.get(docId) || null;
  }
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(STORE_DOCUMENTS, 'readonly');
    const store = tx.objectStore(STORE_DOCUMENTS);
    const req = store.get(docId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * ドキュメントを保存する（自動一時保存でも使用）
 * @param {any} doc
 * @returns {Promise<void>}
 */
export async function saveDocument(doc) {
  if (!doc || !doc.id) throw new Error('Invalid document');
  await initDB();
  doc.updatedAt = Date.now();
  if (useMemoryFallback || !dbInstance) {
    memoryStore.documents.set(doc.id, doc);
    return;
  }
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(STORE_DOCUMENTS, 'readwrite');
    const store = tx.objectStore(STORE_DOCUMENTS);
    const req = store.put(doc);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * ドキュメントを削除する
 * @param {string} docId
 * @returns {Promise<void>}
 */
export async function deleteDocument(docId) {
  await initDB();
  if (useMemoryFallback || !dbInstance) {
    memoryStore.documents.delete(docId);
    return;
  }
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(STORE_DOCUMENTS, 'readwrite');
    const store = tx.objectStore(STORE_DOCUMENTS);
    const req = store.delete(docId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * ユーザー設定（前回使用した文字色・サイズ・ペン設定など）を取得する
 * @param {string} key
 * @param {any} defaultValue
 * @returns {Promise<any>}
 */
export async function getSetting(key, defaultValue = null) {
  await initDB();
  if (useMemoryFallback || !dbInstance) {
    return memoryStore.settings.has(key) ? memoryStore.settings.get(key) : defaultValue;
  }
  return new Promise((resolve) => {
    const tx = dbInstance.transaction(STORE_SETTINGS, 'readonly');
    const store = tx.objectStore(STORE_SETTINGS);
    const req = store.get(key);
    req.onsuccess = () => {
      resolve(req.result ? req.result.value : defaultValue);
    };
    req.onerror = () => resolve(defaultValue);
  });
}

/**
 * ユーザー設定を保存する
 * @param {string} key
 * @param {any} value
 * @returns {Promise<void>}
 */
export async function saveSetting(key, value) {
  await initDB();
  if (useMemoryFallback || !dbInstance) {
    memoryStore.settings.set(key, value);
    return;
  }
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(STORE_SETTINGS, 'readwrite');
    const store = tx.objectStore(STORE_SETTINGS);
    const req = store.put({ key, value });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
