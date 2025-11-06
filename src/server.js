import {readFile, stat} from "node:fs/promises";
import {join} from "node:path";
import {H3, serve, serveStatic, redirect} from "h3";
import {render} from "./renderer.js";
import {
	getOverallCount,
	getUnreadCount,
	getBookmarks,
	getBookmark,
	createBookmark,
} from "./db.js";

const app = new H3();

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
	const all = getOverallCount();
	const unread = getUnreadCount();
	e.context.count = {all, unread};
});
app.get("/", (e) => {
	return render("pages/home.html", {count: e.context.count});
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
		count: e.context.count,
	});
});
app.get("/bookmarks", (e) => {
	const bookmarks = getBookmarks();
	console.log(bookmarks[0]);

	return render("pages/bookmarks.html", {
		count: e.context.count,
		bookmarks,
		query: 'None'
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
	const res = createBookmark(url, name, note, tags);
	return redirect("/bookmarks/" + res);
});
app.get("/bookmarks/:id", (e) => {
	const id = e.context.params.id;
	// TODO: add error code
	if (typeof (id * 1) !== "number") throw new Error("Not Allowed");
	const data = getBookmark(id);
	return render("pages/card.html", {
		count: e.context.count,
		...data,
	});
});

serve(app, {port: process.env.PORT || 3000});
