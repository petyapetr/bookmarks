import {readFile, stat} from "node:fs/promises";
import {join} from "node:path";
import {H3, serve, serveStatic, redirect} from "h3";
import {render} from "./renderer.js";
import DatabaseConnection from "./sqlite-driver.js";

const app = new H3();
const db = new DatabaseConnection(process.env.DB_FILE_URL);

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
	const bookmarks = db.all(`
    SELECT id,
					 url,
					 name,
					 note,
					 read_in_year, 
					 read_in_month FROM bookmarks ORDER BY id DESC;
  `);

	return render("pages/bookmarks.html", {
		bookmarks,
		query: "None",
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
			db.run(insertTag, [tag]);
			db.run(linkBookmarkTag, [id, tag]);
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

serve(app, {port: process.env.PORT || 3000});
