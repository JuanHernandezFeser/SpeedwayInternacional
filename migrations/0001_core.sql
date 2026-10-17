CREATE TABLE riders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  permanent_number INTEGER NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  country_iso TEXT NOT NULL,
  photo_key TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  meeting_date TEXT NOT NULL,
  venue TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'drawn', 'in_progress', 'completed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE meeting_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  rider_id INTEGER NOT NULL REFERENCES riders(id),
  program_number INTEGER CHECK (program_number IS NULL OR program_number BETWEEN 1 AND 16),
  is_reserve INTEGER NOT NULL DEFAULT 0,
  UNIQUE (meeting_id, rider_id),
  UNIQUE (meeting_id, program_number)
);

CREATE TABLE translations (
  entity TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  field TEXT NOT NULL,
  lang TEXT NOT NULL CHECK (lang IN ('es', 'en', 'pl')),
  text TEXT NOT NULL,
  source_hash TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (entity, entity_id, field, lang)
);
