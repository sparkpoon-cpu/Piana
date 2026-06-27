/**
 * Piana Database Layer — Promise-based IndexedDB wrapper
 * Stores: questions, quiz_records, settings, knowledge_points
 */
const DB = (() => {
  const DB_NAME = 'piana_db';
  const DB_VERSION = 2; // v2: Spaced Repetition fields
  let _db = null;

  /** Open / upgrade the database */
  function open() {
    return new Promise((resolve, reject) => {
      if (_db) return resolve(_db);
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        const oldVersion = e.oldVersion;

        // Questions store
        if (!db.objectStoreNames.contains('questions')) {
          const qStore = db.createObjectStore('questions', { keyPath: 'id' });
          qStore.createIndex('category', 'category', { unique: false });
          qStore.createIndex('type', 'type', { unique: false });
          qStore.createIndex('knowledgePoint', 'knowledgePoint', { unique: false });
          qStore.createIndex('srNextReview', 'srNextReview', { unique: false });
          qStore.createIndex('srLevel', 'srLevel', { unique: false });
        } else if (oldVersion < 2) {
          // v1→v2 migration: add SR indexes
          const tx = e.target.transaction;
          const qStore = tx.objectStore('questions');
          if (!qStore.indexNames.contains('srNextReview')) {
            qStore.createIndex('srNextReview', 'srNextReview', { unique: false });
          }
          if (!qStore.indexNames.contains('srLevel')) {
            qStore.createIndex('srLevel', 'srLevel', { unique: false });
          }
        }
        // Quiz records store
        if (!db.objectStoreNames.contains('quiz_records')) {
          const rStore = db.createObjectStore('quiz_records', { keyPath: 'id' });
          rStore.createIndex('date', 'date', { unique: false });
          rStore.createIndex('category', 'category', { unique: false });
        }
        // Settings store
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        // Knowledge points store
        if (!db.objectStoreNames.contains('knowledge_points')) {
          const kStore = db.createObjectStore('knowledge_points', { keyPath: 'id' });
          kStore.createIndex('category', 'category', { unique: false });
        }
      };

      req.onsuccess = (e) => {
        _db = e.target.result;
        resolve(_db);
      };
      req.onerror = () => reject(req.error);
    });
  }

  /** Generic put (insert or update) */
  function put(storeName, data) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(data);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  }

  /** Bulk put */
  function putAll(storeName, items) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      items.forEach(item => store.put(item));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  /** Get by key */
  function get(storeName, key) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  }

  /** Get all records */
  function getAll(storeName) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  }

  /** Get by index */
  function getByIndex(storeName, indexName, value) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const index = tx.objectStore(storeName).index(indexName);
      const req = index.getAll(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  }

  /** Delete by key */
  function remove(storeName, key) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    }));
  }

  /** Clear entire store */
  function clear(storeName) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    }));
  }

  /** Count records */
  function count(storeName) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  }

  // ─── Convenience methods ──────────────────────────────

  /** Generate unique ID */
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }

  /** Get a setting value */
  async function getSetting(key, defaultValue = null) {
    const record = await get('settings', key);
    return record ? record.value : defaultValue;
  }

  /** Save a setting */
  async function setSetting(key, value) {
    await put('settings', { key, value });
  }

  /** Save a quiz record */
  async function saveQuizRecord(record) {
    record.id = uid();
    record.date = new Date().toISOString().split('T')[0];
    await put('quiz_records', record);
    return record;
  }

  /** Get quiz records for last N days */
  async function getRecentRecords(days = 7) {
    const all = await getAll('quiz_records');
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    return all.filter(r => r.date >= cutoffStr).sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Get today's records */
  async function getTodayRecords() {
    const today = new Date().toISOString().split('T')[0];
    return getByIndex('quiz_records', 'date', today);
  }

  /** Get error stats by knowledge point */
  async function getWeakPoints(limit = 5) {
    const all = await getAll('quiz_records');
    const errorMap = {}; // { knowledgePoint: { wrong: N, total: N } }

    all.forEach(record => {
      (record.questions || []).forEach(q => {
        const kp = q.knowledgePoint || '未分类';
        if (!errorMap[kp]) errorMap[kp] = { wrong: 0, total: 0 };
        errorMap[kp].total++;
        if (!q.isCorrect) errorMap[kp].wrong++;
      });
    });

    return Object.entries(errorMap)
      .map(([name, stats]) => ({
        name,
        wrong: stats.wrong,
        total: stats.total,
        rate: stats.total > 0 ? Math.round((stats.wrong / stats.total) * 100) : 0
      }))
      .filter(wp => wp.wrong > 0)
      .sort((a, b) => b.rate - a.rate)
      .slice(0, limit);
  }

  // ─── Spaced Repetition (SM-2 simplified) ──────────

  /** Review intervals in days per SR level (0=new, 5=mastered) */
  const SR_INTERVALS = [0, 1, 3, 7, 14, 30];

  /** Get next review date after N days */
  function daysFromNow(n) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }

  /** Initialize SR fields on a question object (mutates in place) */
  function initSR(q) {
    if (q.srLevel === undefined) q.srLevel = 0;
    if (!q.srNextReview) q.srNextReview = daysFromNow(0); // due immediately
    if (q.srTotalAttempts === undefined) q.srTotalAttempts = 0;
    if (q.srCorrectCount === undefined) q.srCorrectCount = 0;
    q.srLastResult = q.srLastResult || null;
    return q;
  }

  /** Update SR fields after answering a question */
  async function updateQuestionSR(questionId, isCorrect) {
    const q = await get('questions', questionId);
    if (!q) return;
    initSR(q);
    q.srTotalAttempts = (q.srTotalAttempts || 0) + 1;
    if (isCorrect) {
      q.srCorrectCount = (q.srCorrectCount || 0) + 1;
      q.srLevel = Math.min(5, (q.srLevel || 0) + 1);
    } else {
      q.srLevel = Math.max(0, (q.srLevel || 0) - 1);
    }
    q.srLastResult = isCorrect ? 'correct' : 'wrong';
    q.srNextReview = daysFromNow(SR_INTERVALS[q.srLevel]);
    await put('questions', q);
  }

  /** Get questions due for review (srNextReview <= now) */
  async function getDueQuestions(category = 'all', type = 'all') {
    const all = await getAll('questions');
    const now = new Date().toISOString();
    return all.filter(q => {
      initSR(q);
      if (category !== 'all' && q.category !== category) return false;
      if (type === 'choice' && q.type !== 'choice') return false;
      if (type === 'fill' && q.type !== 'fill') return false;
      return q.srNextReview <= now && q.srLevel > 0; // level>0 = has been seen before
    });
  }

  /** Get questions never seen (srLevel = 0) */
  async function getNewQuestions(category = 'all', type = 'all') {
    const all = await getAll('questions');
    return all.filter(q => {
      initSR(q);
      if (category !== 'all' && q.category !== category) return false;
      if (type === 'choice' && q.type !== 'choice') return false;
      if (type === 'fill' && q.type !== 'fill') return false;
      return q.srLevel === 0;
    });
  }

  /** Get SR stats overview */
  async function getSRStats() {
    const all = await getAll('questions');
    const now = new Date().toISOString();
    const stats = { newCount: 0, dueCount: 0, masteredCount: 0, byLevel: {} };
    all.forEach(q => {
      initSR(q);
      if (q.srLevel === 0) stats.newCount++;
      else if (q.srNextReview <= now) stats.dueCount++;
      if (q.srLevel >= 5) stats.masteredCount++;
      stats.byLevel[q.srLevel] = (stats.byLevel[q.srLevel] || 0) + 1;
    });
    return stats;
  }

  /** Get question history from quiz records */
  async function getQuestionHistory(questionId) {
    const all = await getAll('quiz_records');
    const history = [];
    all.forEach(record => {
      (record.questions || []).forEach(q => {
        if (q.questionId === questionId) {
          history.push({
            date: record.date,
            userAnswer: q.userAnswer,
            correctAnswer: q.correctAnswer,
            isCorrect: q.isCorrect,
            timeSpent: q.timeSpent
          });
        }
      });
    });
    return history.sort((a, b) => b.date.localeCompare(a.date));
  }

  /** Ensure all existing questions have SR fields initialized */
  async function migrateSRFields() {
    const all = await getAll('questions');
    let updated = 0;
    for (const q of all) {
      if (q.srLevel === undefined || !q.srNextReview) {
        initSR(q);
        await put('questions', q);
        updated++;
      }
    }
    return updated;
  }

  /** Delete all data */
  async function deleteAll() {
    const stores = ['questions', 'quiz_records', 'settings', 'knowledge_points'];
    for (const s of stores) {
      await clear(s);
    }
  }

  // ─── Preset knowledge categories ──────────────────────
  const PRESET_KNOWLEDGE = [
    // 教育学
    { id: 'edu-1', name: '教育的产生与发展', category: '教育学' },
    { id: 'edu-2', name: '教育学的产生与发展', category: '教育学' },
    { id: 'edu-3', name: '教育与社会发展', category: '教育学' },
    { id: 'edu-4', name: '教育与人的发展', category: '教育学' },
    { id: 'edu-5', name: '教育目的', category: '教育学' },
    { id: 'edu-6', name: '教育制度', category: '教育学' },
    { id: 'edu-7', name: '课程', category: '教育学' },
    { id: 'edu-8', name: '教学（上）', category: '教育学' },
    { id: 'edu-9', name: '教学（下）', category: '教育学' },
    { id: 'edu-10', name: '德育', category: '教育学' },
    { id: 'edu-11', name: '班级管理', category: '教育学' },
    { id: 'edu-12', name: '教师与学生', category: '教育学' },
    { id: 'edu-13', name: '新课程改革', category: '教育学' },
    // 心理学
    { id: 'psy-1', name: '心理学概述', category: '心理学' },
    { id: 'psy-2', name: '认知过程', category: '心理学' },
    { id: 'psy-3', name: '情绪情感与意志', category: '心理学' },
    { id: 'psy-4', name: '个性心理', category: '心理学' },
    { id: 'psy-5', name: '学习理论', category: '心理学' },
    { id: 'psy-6', name: '学习动机', category: '心理学' },
    { id: 'psy-7', name: '学习迁移', category: '心理学' },
    { id: 'psy-8', name: '知识与技能的学习', category: '心理学' },
    { id: 'psy-9', name: '问题解决与创造性', category: '心理学' },
    { id: 'psy-10', name: '学生心理发展', category: '心理学' },
    { id: 'psy-11', name: '教师心理', category: '心理学' },
    // 美术
    { id: 'art-1', name: '美术基础知识', category: '美术' },
    { id: 'art-2', name: '中国美术史', category: '美术' },
    { id: 'art-3', name: '外国美术史', category: '美术' },
    { id: 'art-4', name: '美术课程标准', category: '美术' },
    { id: 'art-5', name: '美术教学设计', category: '美术' },
    { id: 'art-6', name: '美术教学评价', category: '美术' },
    { id: 'art-7', name: '儿童美术心理', category: '美术' },
  ];

  /** Default settings — API key loaded from config.local.js (gitignored) */
  const DEFAULT_SETTINGS = {
    // deepseek_api_key: 请创建项目根目录下的 config.local.js 文件，格式见 README
    // 文件内容示例：window.PIANA_CONFIG = { deepseek_api_key: 'sk-你的key' };
    // config.local.js 已加入 .gitignore，不会上传到 GitHub
    deepseek_api_key: (typeof window !== 'undefined' && window.PIANA_CONFIG?.deepseek_api_key) || '',
    dailyGoal: '20',
    quizCount: '10'
  };

  /** Import seed questions from JSON file if question bank is empty */
  async function importSeedQuestions() {
    const existingCount = await count('questions');
    if (existingCount > 0) return existingCount; // Already has questions, skip

    try {
      const resp = await fetch('/questions-seed.json');
      if (!resp.ok) {
        console.warn('Seed file not found, skipping import');
        return 0;
      }
      const data = await resp.json();
      const questions = data.questions || [];
      if (questions.length === 0) return 0;

      // Ensure all questions have SR fields initialized
      questions.forEach(q => initSR(q));

      await putAll('questions', questions);
      console.log(`🌱 Imported ${questions.length} seed questions`);
      return questions.length;
    } catch (e) {
      console.warn('Seed import failed:', e.message);
      return 0;
    }
  }

  /** Initialize preset knowledge points and default settings if empty */
  async function initPresets() {
    const existing = await getAll('knowledge_points');
    if (existing.length === 0) {
      await putAll('knowledge_points', PRESET_KNOWLEDGE);
    }
    // Pre-populate default settings (won't overwrite existing)
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      const existingSetting = await get('settings', key);
      if (!existingSetting) {
        await put('settings', { key, value });
      }
    }
    // Migrate existing questions to have SR fields
    await migrateSRFields();
    // Import seed questions if bank is empty (runs in background)
    importSeedQuestions().catch(e => console.warn('Seed import error:', e));
  }

  // Public API
  return {
    open, put, putAll, get, getAll, getByIndex, remove, clear, count,
    uid, getSetting, setSetting,
    saveQuizRecord, getRecentRecords, getTodayRecords, getWeakPoints,
    deleteAll, initPresets, PRESET_KNOWLEDGE,
    // Spaced Repetition
    SR_INTERVALS, initSR, updateQuestionSR, getDueQuestions,
    getNewQuestions, getSRStats, getQuestionHistory, daysFromNow, migrateSRFields
  };
})();
