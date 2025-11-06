import Database from "better-sqlite3";

const db = new Database(process.env.DB_FILE_URL, {
	fileMustExist: true,
});
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function createBookmark(
	url,
	name,
	note,
	tags = [],
	readInYear = null,
	readInMonth = null
) {
	const insertBookmark = db.prepare(`
    INSERT INTO bookmarks (url, name, note, read_in_year, read_in_month)
    VALUES (?, ?, ?, ?, ?)
  `);

	const insertTag = db.prepare(`
    INSERT OR IGNORE INTO tags (name)
    VALUES (?)
  `);

	const linkBookmarkTag = db.prepare(`
    INSERT INTO bookmark_tags (bookmark_id, tag_id)
    VALUES (?, (SELECT id FROM tags WHERE name = ?))
  `);

	const transaction = db.transaction(() => {
		const result = insertBookmark.run(url, name, note, readInYear, readInMonth);
		const bookmarkId = result.lastInsertRowid;

		tags.forEach((tag) => {
			insertTag.run(tag);
			linkBookmarkTag.run(bookmarkId, tag);
		});

		return bookmarkId;
	});

	return transaction();
}

export function getOverallCount() {
	const statement = db.prepare(`
			SELECT COUNT(*) as count FROM bookmarks;  
		`);

	return statement.get().count;
}

export function getUnreadCount() {
	const statement = db.prepare(`
			SELECT COUNT(*) as count FROM bookmarks WHERE read_in_year IS NULL;  
		`);

	return statement.get().count;
}

export function getBookmark(id) {
	const statement = db.prepare(`
    SELECT id,
					 url,
					 name,
					 note,
					 read_in_year, 
					 read_in_month FROM bookmarks WHERE id = ?
  `);

	return statement.get(id);
}

export function getBookmarks() {
	const statement = db.prepare(`
    SELECT id,
					 url,
					 name,
					 note,
					 read_in_year, 
					 read_in_month FROM bookmarks ORDER BY id DESC;
  `);

	return statement.all();
}
