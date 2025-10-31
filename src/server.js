import {readFile, stat} from "node:fs/promises";
import {join} from "node:path";
import {H3, serve, serveStatic} from "h3";
import {render} from "./renderer.js";

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
app.get("/", (e) => "⚡️ Tadaa!");
app.get("/about", (e) =>
	render("pages/about.html", {text: "About njk templates"})
);
app.get("/foo", (e) => render("pages/foo.html", {user: {name: "hal"}}));

serve(app, {port: process.env.PORT || 3000});
