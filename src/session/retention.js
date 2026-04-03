export function purgeOldSessionEvents(db, maxAgeMs = 1000 * 60 * 60 * 24 * 14) {
  const cutoff = Date.now() - maxAgeMs;
  db.prepare(`DELETE FROM session_events WHERE created_at <= ?`).run(cutoff);
  db.prepare(`
    DELETE FROM session_edges
    WHERE from_event_id NOT IN (SELECT event_id FROM session_events)
       OR to_event_id NOT IN (SELECT event_id FROM session_events)
  `).run();
}
