// source: https://github.com/alexpetros/copy-this-code/blob/main/js/sqlite-driver.js
import Database from "better-sqlite3";

export default class DatabaseConnection {
	db;

	constructor(fileName) {
		const dbName = fileName || ":memory:";
		try {
			this.db = new Database(dbName, {fileMustExist: true});
		} catch (err) {
			if (err.code === "SQLITE_CANTOPEN") {
				console.log(
					`Note: database ${dbName} does not exist; starting new one`
				);
				this.db = new Database(dbName);
				// Add the migrations table to the new database
				// this.run(`
				//   CREATE TABLE _migrations (
				//     filename TEXT NOT NULL,
				//     timestamp INTEGER DEFAULT CURRENT_TIMESTAMP
				//   );
				// `);
			} else {
				throw err;
			}
		}
	}

	get(query, ...params) {
		return this.db.prepare(query).get(params);
	}

	all(query, ...params) {
		return this.db.prepare(query).all(params);
	}

	run(query, ...params) {
		return this.db.prepare(query).run(...params);
	}

	prepare(query) {
		return this.db.prepare(query);
	}

	transaction(fn) {
		return this.db.transaction(fn);
	}
}
