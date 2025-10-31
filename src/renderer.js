import {html} from "h3";
import nunjucks from "nunjucks";

const njk = new nunjucks.Environment(
	new nunjucks.FileSystemLoader("src/templates")
);

export function render(path, data) {
	const content = njk.render(path, data);

	return html(content);
}
