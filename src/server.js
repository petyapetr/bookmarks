import {readFile, stat} from "node:fs/promises";
import {join} from "node:path";
import nunjucks from "nunjucks";
import {H3, serve, serveStatic, html, redirect} from "h3";
import DatabaseConnection from "./sqlite-driver.js";

const app = new H3();
const db = new DatabaseConnection(process.env.DB_FILE_URL);
const njk = new nunjucks.Environment(
	new nunjucks.FileSystemLoader("src/templates")
);
function render(path, data) {
	const content = njk.render(path, data);

	return html(content);
}

app.use("/public/**", (event) =>
	serveStatic(event, {
		getContents: (id) => {
			return readFile(join("./", id));
		},
		getMeta: async (id) => {
			const stats = await stat(join("./", id));
			if (stats?.isFile()) {
				return {
					size: stats.size,
					mtime: stats.mtimeMs,
				};
			}
		},
	})
);
app.use("**", (e) => {
	const all = db.get("SELECT COUNT(*) as count FROM bookmarks;").count;
	const unread = db.get(
		"SELECT COUNT(*) as count FROM bookmarks WHERE read_in_year IS NULL;"
	).count;
	const random = Math.ceil(Math.random() * all);
	e.context.template = {all, unread, random};
});
app.get("/", (e) => {
	return render("pages/home.html", {
		...e.context.template,
	});
});
app.get("/search", (e) => {
	const currentYear = new Date().getFullYear();
	const years = [];
	for (let year = 2024; year <= currentYear; year++) {
		years.push(year);
	}

	return render("pages/search.html", {
		years,
		tags: ["code", "star", "work", "best", "gis", "blog"],
		...e.context.template,
	});
});
app.get("/bookmarks", (e) => {
	const query = new URL(`http://localhost${e.node.req.url}`);
	const params = query.searchParams;

	let sql = `
		SELECT DISTINCT
			b.id,
			b.url,
			b.name,
			b.note,
			b.read_in_year,
			b.read_in_month
		FROM bookmarks b
		LEFT JOIN bookmark_tags bt ON b.id = bt.bookmark_id
		LEFT JOIN tags t ON bt.tag_id = t.id
		WHERE 1=1
	`;

	const queryParams = [];

	const statuses = new Set(params.getAll("statuses"));
	const years = [...new Set(params.getAll("years"))];
	const months = [...new Set(params.getAll("months"))];
	const tags = [...new Set(params.getAll("tags"))];

	if (statuses.has("read")) {
		if (years.length === 0) {
			sql += ` AND b.read_in_year IS NOT NULL`;
		} else {
			const yearPlaceholders = createPlaceholders(years.length);
			sql += ` AND b.read_in_year IN (${yearPlaceholders})`;
			queryParams.push(...years);
		}
		if (months.size > 0) {
			const monthPlaceholders = createPlaceholders(months.length);
			sql += ` AND b.read_in_month IN (${monthPlaceholders})`;
			queryParams.push(...months);
		}
	}

	if (statuses.has("unread")) {
		if (years.length === 0) {
			sql += ` AND b.read_in_year IS NULL`;
		} else {
			const yearPlaceholders = createPlaceholders(years.length);
			sql += ` AND strftime("%Y", b.created_at) IN (${yearPlaceholders})`;
			queryParams.push(...years);
		}

		if (months.size > 0) {
			const monthPlaceholders = createPlaceholders(months.length);
			sql += ` AND strftime("%m", b.created_at) IN (${monthPlaceholders})`;
			queryParams.push(...months);
		}
	}

	if (tags.length > 0) {
		const tagPlaceholders = createPlaceholders(tags.length);
		sql += ` AND t.name IN (${tagPlaceholders})`;
		queryParams.push(...tags);
		sql += ` GROUP BY b.id HAVING COUNT(DISTINCT t.id) = ?`;
		queryParams.push(tags.length);
	}

	sql += ` ORDER BY b.id DESC`;

	const bookmarks = db.prepare(sql).all(...queryParams);

	return render("pages/bookmarks.html", {
		bookmarks,
		query: params.toString(),
		...e.context.template,
	});
});
app.post("/bookmarks", async (e) => {
	const body = await e.req.formData();
	const url = body.get("url");
	// TODO: add error code
	if (url === null) throw new Error("Wrong input");
	const name = body.get("name") ?? new URL(url).hostname;
	const note = body.get("note");
	const tags = body.get("tags")?.split(",");
	// const res = createBookmark(url, name, note, tags);
	const insertBookmark = `
			INSERT INTO bookmarks (url, name, note)
			VALUES (?, ?, ?)
		`;
	const insertTag = `
			INSERT OR IGNORE INTO tags (name)
			VALUES (?)
		`;
	const linkBookmarkTag = `
			INSERT INTO bookmark_tags (bookmark_id, tag_id)
			VALUES (?, (SELECT id FROM tags WHERE name = ?))
		`;
	const res = db.transaction(() => {
		const bookmark = db.run(insertBookmark, [url, name, note]);
		const id = bookmark.lastInsertRowid;
		tags.forEach((tag) => {
			db.run(insertTag, tag);
			db.run(linkBookmarkTag, id, tag);
		});
		return id;
	})();
	return redirect("/bookmarks/" + res);
});
app.get("/bookmarks/:id", (e) => {
	const id = e.context.params.id;
	// TODO: add error code
	if (typeof (id * 1) !== "number") throw new Error("Not Allowed");
	const data = db.get(
		`SELECT id,
							url,
							name,
							note,
							read_in_year, 
							read_in_month FROM bookmarks WHERE id = ?
		`,
		id
	);
	return render("pages/card.html", {
		...data,
		...e.context.template,
	});
});
// NOTE: should be PUT though
app.post("/bookmarks/:id", async (e) => {
	const body = await e.req.formData();
	const {name, url, note, read_in_month, read_in_year} = Object.fromEntries(
		body.entries().map(([_, val]) => [_, !val ? null : val])
	);
	db.run(
		`UPDATE bookmarks
    SET name = ?, url = ?, note = ?, read_in_month = ?, read_in_year = ?
		WHERE id = ?`,
		name,
		url,
		note,
		read_in_month,
		read_in_year,
		e.context.params.id
	);
	return redirect("/bookmarks/" + e.context.params.id);
});
app.post("/bookmarks/:id/mark-read", (e) => {
	const date = new Date();
	const read_in_year = date.getFullYear();
	const read_in_month = date.getMonth() + 1;
	db.run(
		`UPDATE bookmarks
		SET read_in_year = ?, read_in_month = ?
		WHERE id = ?`,
		read_in_year,
		read_in_month,
		e.context.params.id
	);
	return redirect("/bookmarks/" + e.context.params.id);
});
// NOTE: should be DELETE, htmx has a point tbh
app.post("/bookmarks/:id/delete", (e) => {
	const {id} = e.context.params;
	db.transaction(() => {
		db.run(`DELETE FROM bookmark_tags WHERE bookmark_id = ?`, id);
		db.run(`
			DELETE from tags WHERE id NOT IN (
				SELECT DISTINCT tag_id FROM bookmark_tags
			)`);
		db.run(`DELETE FROM bookmarks WHERE id = ?`, id);
	})();
	return redirect("/bookmarks");
});

function createPlaceholders(size) {
	let result = "";
	for (let i = 0; i < size; i++) {
		result += i > 0 ? ",?" : "?";
	}
	return result;
}

serve(app, {port: process.env.PORT || 3000});
