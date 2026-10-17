CREATE TABLE races (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  race_number INTEGER NOT NULL CHECK (race_number BETWEEN 1 AND 23),
  kind TEXT NOT NULL CHECK (kind IN ('heat', 'lcq1', 'lcq2', 'final')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'gates_assigned', 'completed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (meeting_id, race_number)
);

CREATE TABLE race_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  race_id INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  rider_id INTEGER NOT NULL REFERENCES riders(id),
  replaced_rider_id INTEGER REFERENCES riders(id),
  gate INTEGER CHECK (gate IS NULL OR gate BETWEEN 1 AND 4),
  finish_position INTEGER CHECK (finish_position IS NULL OR finish_position BETWEEN 1 AND 4),
  status TEXT NOT NULL DEFAULT 'ok'
    CHECK (status IN ('ok', 'M', 'R', 'F', 'T', 'd', 'N')),
  points REAL,
  UNIQUE (race_id, rider_id),
  UNIQUE (race_id, gate)
);
