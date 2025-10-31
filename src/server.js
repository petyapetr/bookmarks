import {readFile, stat} from "node:fs/promises";
import {join} from "node:path";
import {H3, serve, html, serveStatic} from "h3";
import {Eta} from "eta";

const app = new H3();

const eta = new Eta({
	views: join(import.meta.dirname, "templates"),
});

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
app.get("/", (e) => "⚡️ Tadaa!");
// app.get("/about", (e) => {
// 	const template = readFileSync("src/templates/about.html", "utf-8");
// 	const content = Mustache.render(template, {text: "about"});

// 	return html(content);
// });
app.get("/about", (e) => {
	const content = eta.render("pages/about.html", {text: "About eta"});

	return html(content);
});
app.get("/foo", (e) => {
	const content = eta.render("pages/foo", {text: "Foo"});

	return html(content);
});

serve(app, {port: process.env.PORT || 3000});
