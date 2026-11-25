// SQLite persistence (node:sqlite). One JSON blob per player for game state; tables for cross-player data.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL,
  recovery_hash TEXT UNIQUE, banned INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, player_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_player ON sessions(player_id);
CREATE TABLE IF NOT EXISTS player_state (
  player_id TEXT PRIMARY KEY, version INTEGER NOT NULL, state_json TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS likes (
  owner_id TEXT NOT NULL, liker_id TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY(owner_id, liker_id, day)
);
CREATE TABLE IF NOT EXISTS garden_stats (owner_id TEXT PRIMARY KEY, likes_total INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS chat_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT NOT NULL, player_id TEXT NOT NULL, at INTEGER NOT NULL, text TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS friends (a TEXT NOT NULL, b TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(a, b));
CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, reporter TEXT NOT NULL, target TEXT NOT NULL, at INTEGER NOT NULL, reason TEXT, context TEXT);
CREATE TABLE IF NOT EXISTS wallets (player_id TEXT PRIMARY KEY, address TEXT NOT NULL UNIQUE, linked_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS season_points (player_id TEXT NOT NULL, week TEXT NOT NULL, points INTEGER NOT NULL, PRIMARY KEY(player_id, week));
CREATE TABLE IF NOT EXISTS reward_epochs (id INTEGER PRIMARY KEY, week TEXT NOT NULL UNIQUE, root TEXT NOT NULL, total TEXT NOT NULL, claim_deadline INTEGER NOT NULL, created_at INTEGER NOT NULL, status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reward_allocations (epoch INTEGER NOT NULL, idx INTEGER NOT NULL, player_id TEXT NOT NULL, wallet TEXT NOT NULL, amount TEXT NOT NULL, points INTEGER NOT NULL, proof TEXT NOT NULL, PRIMARY KEY(epoch, idx));
CREATE INDEX IF NOT EXISTS reward_alloc_player ON reward_allocations(player_id);
CREATE TABLE IF NOT EXISTS reward_carry (player_id TEXT PRIMARY KEY, amount TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mgrd_orders (order_id TEXT PRIMARY KEY, player_id TEXT NOT NULL, item TEXT NOT NULL, amount TEXT NOT NULL, usd REAL NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, status TEXT NOT NULL, payer TEXT);
CREATE TABLE IF NOT EXISTS challenge_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, week TEXT NOT NULL, player_id TEXT NOT NULL, post_id TEXT NOT NULL, url TEXT NOT NULL,
  title TEXT NOT NULL, at INTEGER NOT NULL, status TEXT NOT NULL, UNIQUE(week, player_id), UNIQUE(week, post_id)
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, player_id TEXT, at INTEGER NOT NULL, kind TEXT NOT NULL, data TEXT
);
`;

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  // migration: friend codes for players
  if (!db.prepare('PRAGMA table_info(players)').all().some((c) => c.name === 'friend_code')) db.exec('ALTER TABLE players ADD COLUMN friend_code TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS players_friend_code ON players(friend_code)');
  const q = {
    getMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
    setMeta: db.prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    insertPlayer: db.prepare('INSERT INTO players(id, name, created_at, last_seen, recovery_hash) VALUES(?, ?, ?, ?, ?)'),
    getPlayer: db.prepare('SELECT * FROM players WHERE id = ?'),
    playerByRecovery: db.prepare('SELECT * FROM players WHERE recovery_hash = ?'),
    touchPlayer: db.prepare('UPDATE players SET last_seen = ? WHERE id = ?'),
    insertSession: db.prepare('INSERT INTO sessions(token_hash, player_id, created_at, expires_at) VALUES(?, ?, ?, ?)'),
    getSession: db.prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?'),
    getState: db.prepare('SELECT state_json FROM player_state WHERE player_id = ?'),
    putPoints: db.prepare('INSERT INTO season_points(player_id, week, points) VALUES(?, ?, ?) ON CONFLICT(player_id, week) DO UPDATE SET points = MAX(points, excluded.points)'),
    putState: db.prepare(`INSERT INTO player_state(player_id, version, state_json, updated_at) VALUES(?, ?, ?, ?)
      ON CONFLICT(player_id) DO UPDATE SET version = excluded.version, state_json = excluded.state_json, updated_at = excluded.updated_at`),
    addLike: db.prepare('INSERT OR IGNORE INTO likes(owner_id, liker_id, day) VALUES(?, ?, ?)'),
    bumpLikes: db.prepare(`INSERT INTO garden_stats(owner_id, likes_total) VALUES(?, 1)
      ON CONFLICT(owner_id) DO UPDATE SET likes_total = likes_total + 1`),
    getLikes: db.prepare('SELECT likes_total FROM garden_stats WHERE owner_id = ?'),
    likedToday: db.prepare('SELECT owner_id FROM likes WHERE liker_id = ? AND day = ?'),
    stamps: db.prepare('SELECT p.name, l.day FROM likes l JOIN players p ON p.id = l.liker_id WHERE l.owner_id = ? ORDER BY l.day DESC, p.name LIMIT 30'),
    chat: db.prepare('INSERT INTO chat_log(room_id, player_id, at, text) VALUES(?, ?, ?, ?)'),
    pruneChat: db.prepare('DELETE FROM chat_log WHERE at < ?'),
    audit: db.prepare('INSERT INTO audit(player_id, at, kind, data) VALUES(?, ?, ?, ?)'),
    setCode: db.prepare('UPDATE players SET friend_code = ? WHERE id = ?'),
    byCode: db.prepare('SELECT * FROM players WHERE friend_code = ?'),
    addFriend: db.prepare('INSERT OR IGNORE INTO friends(a, b, at) VALUES(?, ?, ?)'),
    removeFriend: db.prepare('DELETE FROM friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)'),
    friendsOf: db.prepare('SELECT p.id, p.name, p.friend_code FROM friends f JOIN players p ON p.id = f.b WHERE f.a = ?'),
    isFriend: db.prepare('SELECT 1 FROM friends WHERE a = ? AND b = ?'),
    report: db.prepare('INSERT INTO reports(reporter, target, at, reason, context) VALUES(?, ?, ?, ?, ?)'),
    myEntry: db.prepare('SELECT * FROM challenge_entries WHERE week = ? AND player_id = ?'),
    entryByPost: db.prepare('SELECT * FROM challenge_entries WHERE week = ? AND post_id = ?'),
    putEntry: db.prepare(`INSERT INTO challenge_entries(week, player_id, post_id, url, title, at, status) VALUES(?, ?, ?, ?, ?, ?, 'pending')
      ON CONFLICT(week, player_id) DO UPDATE SET post_id = excluded.post_id, url = excluded.url, title = excluded.title, at = excluded.at, status = 'pending'`),
    featuredEntries: db.prepare("SELECT e.title, e.url, p.name AS by FROM challenge_entries e JOIN players p ON p.id = e.player_id WHERE e.week = ? AND e.status = 'featured' AND p.banned = 0 ORDER BY e.at LIMIT 10"),
    listEntries: db.prepare('SELECT e.id, e.week, e.status, e.title, e.url, e.at, p.name AS by FROM challenge_entries e JOIN players p ON p.id = e.player_id WHERE (?1 IS NULL OR e.week = ?1) AND (?2 IS NULL OR e.status = ?2) ORDER BY e.at'),
    setEntry: db.prepare('UPDATE challenge_entries SET status = ? WHERE id = ?'),
  };
  return {
    raw: db,
    meta: (k) => q.getMeta.get(k)?.value ?? null,
    setMeta: (k, v) => q.setMeta.run(k, String(v)),
    createPlayer: (p) => q.insertPlayer.run(p.id, p.name, p.now, p.now, p.recoveryHash),
    player: (id) => q.getPlayer.get(id) ?? null,
    playerByRecovery: (h) => q.playerByRecovery.get(h) ?? null,
    touch: (id, now) => q.touchPlayer.run(now, id),
    createSession: (hash, pid, now, exp) => q.insertSession.run(hash, pid, now, exp),
    session: (hash, now) => q.getSession.get(hash, now) ?? null,
    loadState: (pid) => { const r = q.getState.get(pid); return r ? JSON.parse(r.state_json) : null; },
    /** Save many states in one transaction. */
    saveStates(list, now) {
      if (!list.length) return;
      db.exec('BEGIN');
      try {
        for (const { pid, state } of list) {
          q.putState.run(pid, state.v ?? 1, JSON.stringify(state), now);
          // season points feed the weekly MGRD pools (recorded per week, only ever upward)
          if (state.sp?.points) q.putPoints.run(pid, state.sp.week, state.sp.points);
          if (state.spPrev?.points) q.putPoints.run(pid, state.spPrev.week, state.spPrev.points);
        }
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    like(owner, liker, day) {
      const r = q.addLike.run(owner, liker, day);
      if (r.changes === 1) q.bumpLikes.run(owner);
      return r.changes === 1;
    },
    likes: (owner) => q.getLikes.get(owner)?.likes_total ?? 0,
    likedToday: (liker, day) => q.likedToday.all(liker, day).map((r) => r.owner_id),
    stamps: (owner) => q.stamps.all(owner).map((r) => ({ name: r.name, day: r.day })),
    challengeEntry: (week, pid) => q.myEntry.get(week, pid) ?? null,
    /** One entry per player per week: a new link replaces it, until a moderator has featured it. */
    submitEntry(week, pid, postId, url, title, at) {
      if (q.myEntry.get(week, pid)?.status === 'featured') return 'featured';
      const other = q.entryByPost.get(week, postId);
      if (other && other.player_id !== pid) return 'taken';
      q.putEntry.run(week, pid, postId, url, title, at);
      return 'ok';
    },
    featuredEntries: (week) => q.featuredEntries.all(week).map((r) => ({ title: r.title, by: r.by, url: r.url })),
    listEntries: (week = null, status = null) => q.listEntries.all(week, status).map((r) => ({ ...r })),
    setEntryStatus: (id, status) => q.setEntry.run(status, id).changes === 1,
    logChat: (room, pid, at, text) => q.chat.run(room, pid, at, text),
    pruneChat: (before) => q.pruneChat.run(before),
    audit: (pid, at, kind, data) => q.audit.run(pid, at, kind, JSON.stringify(data ?? null)),
    friendCode(pid, make) {
      const p = q.getPlayer.get(pid);
      if (p?.friend_code) return p.friend_code;
      for (let i = 0; i < 20; i++) { const c = make(); try { q.setCode.run(c, pid); return c; } catch { /* taken */ } }
      return null;
    },
    playerByCode: (c) => q.byCode.get(c) ?? null,
    befriend(a, b, now) { q.addFriend.run(a, b, now); q.addFriend.run(b, a, now); },
    unfriend: (a, b) => q.removeFriend.run(a, b, b, a),
    friends: (pid) => q.friendsOf.all(pid),
    areFriends: (a, b) => !!q.isFriend.get(a, b),
    report: (from, target, at, reason, ctx) => q.report.run(from, target, at, reason, JSON.stringify(ctx ?? [])),
    /** Direct SQL for the chain module and admin tools. */
    raw: db,
    close: () => db.close(),
  };
}
