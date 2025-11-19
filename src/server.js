import {readFile, stat} from "node:fs/promises";
import {join} from "node:path";
import nunjucks from "nunjucks";
import {
	H3,
	serve,
	serveStatic,
	html,
	redirect,
	HTTPError,
	setCookie,
	getCookie,
} from "h3";
import DatabaseConnection from "./sqlite-driver.js";

const MONTHS = new Map([
	["01", "Jan"],
	["02", "Feb"],
	["03", "Mar"],
	["04", "Apr"],
	["05", "May"],
	["06", "Jun"],
	["07", "Jul"],
	["08", "Aug"],
	["09", "Sep"],
	["10", "Oct"],
	["11", "Nov"],
	["12", "Dec"],
]);

const app = new H3({
	onError: (error) => {
		console.log(error);
	},
});
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
app.use("**", (e) => {
	if (e.url.pathname === "/login") return;
	const isAuthenticated = getCookie(e, "authenticated");
	if (!isAuthenticated) return redirect("/login");
});
app.get("/login", () => {
	return render("pages/login.html");
});
app.post("/login", async (e) => {
	const body = await e.req.formData();
	const password = body.get("password");

	if (password === process.env.ADMIN_PASSWORD) {
		setCookie(e, "authenticated", "true", {
			maxAge: 60 * 60 * 24 * 30,
			httpOnly: true,
			secure: true,
			sameSite: "Strict",
		});
		return redirect("/");
	}

	return redirect("/login");
});
app.get("/", (e) => {
	return render("pages/home.html", {
		...e.context.template,
	});
});
app.get("/search", (e) => {
	const currentYear = new Date().getFullYear();
	const years = [];
	for (let year = 2023; year <= currentYear; year++) {
		years.push(year);
	}
	const tags = db
		.all(`SELECT DISTINCT name FROM tags`)
		.map((t) => t.name)
		.filter((tag) => !!tag);

	return render("pages/search.html", {
		years,
		tags,
		...e.context.template,
	});
});
app.get("/bookmarks", (e) => {
	const query = new URL(e.req.url);
	const params = query.searchParams;
	const queryParams = [];
	const statuses = new Set(params.getAll("statuses"));
	const years = [...new Set(params.getAll("years"))];
	const months = [...new Set(params.getAll("months"))];
	const tags = [...new Set(params.getAll("tags"))];
	let sql = `
		SELECT DISTINCT
			b.id,
			b.url,
			b.name,
			b.note,
			b.read_in_year,
			b.read_in_month
		FROM bookmarks b ${tags.length > 0 ? " LEFT JOIN bookmark_tags bt ON b.id = bt.bookmark_id \nLEFT JOIN tags t ON bt.tag_id = t.id" : ""}
		WHERE 1=1
	`;

	let statusClause = [];
	if (statuses.has("read")) {
		statusClause.push("(b.read_in_year IS NOT NULL)");
	}

	if (statuses.has("unread")) {
		statusClause.push("(b.read_in_year IS NULL)");
	}

	if (statusClause.length > 0) {
		sql += ` AND ${statusClause.length > 1 ? `(${statusClause.join(" OR ")})` : statusClause[0]}`;
	}

	if (years.length > 0) {
		const yearPlaceholders = createPlaceholders(years.length);
		let yearClause = [];

		if (statuses.has("read")) {
			yearClause.push(`b.read_in_year IN (${yearPlaceholders})`);
			queryParams.push(...years);
		}

		if (statuses.has("unread")) {
			yearClause.push(`strftime('%Y', b.created_at) IN (${yearPlaceholders})`);
			queryParams.push(...years);
		}

		if (yearClause.length > 0) {
			sql += ` AND (${yearClause.join(" OR ")})`;
		}
	}

	if (months.length > 0) {
		const monthPlaceholders = createPlaceholders(months.length);
		let monthClause = [];

		if (statuses.has("read")) {
			monthClause.push(`b.read_in_month IN (${monthPlaceholders})`);
			queryParams.push(...months);
		}

		if (statuses.has("unread")) {
			monthClause.push(
				`strftime('%m', b.created_at) IN (${monthPlaceholders})`
			);
			queryParams.push(...months);
		}

		if (monthClause.length > 0) {
			sql += ` AND (${monthClause.join(" OR ")})`;
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

	// TODO: add flat error handling
	let bookmarks;
	try {
		bookmarks = db.prepare(sql).all(...queryParams);
	} catch (e) {
		throw new HTTPError(e.message);
	}

	return render("pages/bookmarks.html", {
		bookmarks: bookmarks.map((b) => ({
			...b,
			read_in: `${b.read_in_month ? MONTHS.get(String(b.read_in_month).padStart(2, "0")) + " " : ""}${b.read_in_year ? b.read_in_year : ""}`,
		})),
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
	if (isNaN(id * 1)) throw new HTTPError("Not Allowed");
	const data = db.get(
		`SELECT id,
						url,
						name,
						note,
						read_in_year, 
						read_in_month 
		FROM bookmarks 
		WHERE id = ?`,
		id
	);
	const tags = db
		.all(
			`SELECT name FROM tags WHERE id = (SELECT tag_id FROM bookmark_tags WHERE bookmark_id = ?)`,
			id
		)
		.map((t) => t.name)
		.filter((tag) => !!tag);

	return render("pages/card.html", {
		...data,
		tags,
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
