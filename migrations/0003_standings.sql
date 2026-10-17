CREATE TABLE intermediate_standings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  rider_id INTEGER NOT NULL REFERENCES riders(id),
  heat_points REAL NOT NULL DEFAULT 0,
  rank INTEGER NOT NULL,
  requires_manual_resolution INTEGER NOT NULL DEFAULT 0,
  manual_order INTEGER,
  UNIQUE (meeting_id, rider_id),
  UNIQUE (meeting_id, rank)
);

CREATE TABLE meeting_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  rider_id INTEGER NOT NULL REFERENCES riders(id),
  rank INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 18),
  championship_points INTEGER NOT NULL,
  UNIQUE (meeting_id, rider_id),
  UNIQUE (meeting_id, rank)
);

CREATE TABLE championship_standings (
  rider_id INTEGER PRIMARY KEY REFERENCES riders(id),
  rank INTEGER NOT NULL,
  total_points INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE rider_stats (
  rider_id INTEGER PRIMARY KEY REFERENCES riders(id),
  meetings_disputed INTEGER NOT NULL DEFAULT 0,
  best_meeting_result INTEGER,
  heats_raced INTEGER NOT NULL DEFAULT 0,
  heat_wins INTEGER NOT NULL DEFAULT 0,
  points_avg REAL NOT NULL DEFAULT 0,
  final_appearances INTEGER NOT NULL DEFAULT 0
);
