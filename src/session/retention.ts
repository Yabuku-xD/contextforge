export function purgeOldSessionEvents(db, maxAgeMs = 1000 * 60 * 60 * 24 * 14) {
  const cutoff = Date.now() - maxAgeMs;
  const staleEventIds = db.prepare(`SELECT event_id AS eventId FROM session_events WHERE created_at <= ?`).all(cutoff);
  for (const event of staleEventIds) {
    db.prepare(`DELETE FROM session_event_fts WHERE event_id = ?`).run(event.eventId);
  }
  db.prepare(`DELETE FROM session_events WHERE created_at <= ?`).run(cutoff);
  db.prepare(`
    DELETE FROM session_edges
    WHERE from_event_id NOT IN (SELECT event_id FROM session_events)
       OR to_event_id NOT IN (SELECT event_id FROM session_events)
  `).run();
}
