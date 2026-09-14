// Deliberately kept out of database.ts: importing the Database *class*
// (e.g. from a test, for an isolated `:memory:` instance) must not open
// the real db.sqlite as a side effect - that used to make every test file
// that imported Database race to open/migrate the same real file.

import { Database } from "./database.ts";

export const db = new Database();

process.on("exit", () => db.close());
