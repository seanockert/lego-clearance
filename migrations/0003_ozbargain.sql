-- OzBargain posts already seen. A post not in this table is new and gets an alert.
CREATE TABLE ozb_posts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  seen_at TEXT NOT NULL
);
