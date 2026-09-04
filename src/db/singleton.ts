// Single shared connection to the CLI's sqlite db, so modules don't each
// open their own handle to the same file.
//
// Deliberately kept out of database.ts: importing the Database *class*
// (e.g. from tests, to construct an isolated `:memory:` instance) must not
// have the side effect of opening the real ~/.apiweiser-scanner/db.sqlite
// file. When that side effect lived in database.ts, every test file that
// imported Database triggered it too, and concurrent test processes ended
// up racing to open and migrate the same real file.

import { Database } from "./database.ts";

export const db = new Database();

process.on("exit", () => db.close());
