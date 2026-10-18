import assert from "node:assert/strict";
import { test } from "node:test";
import { branchName, commitMessage } from "../../src/github/pr-naming.ts";

const baseUi = { name: "@base-ui/react", version: "1.3.0", newVersion: "1.9.0" };
const dateFns = { name: "date-fns", version: "3.6.0", newVersion: "4.4.0" };

test("branchName drops the leading @ of a scoped package instead of turning it into a dash", () => {
  assert.equal(branchName([baseUi]), "apiweiser-cli/base-ui/react-1.9.0");
});

test("branchName names every package of a mixed-scope group, each with its own version", () => {
  assert.equal(branchName([baseUi, dateFns]), "apiweiser-cli/base-ui/react-1.9.0+date-fns-4.4.0");
});

test("branchName names a shared-scope group after the scope", () => {
  const group = [
    { name: "@angular/core", version: "5.0.0", newVersion: "20.0.0" },
    { name: "@angular/router", version: "5.0.0", newVersion: "20.0.0" },
  ];
  assert.equal(branchName(group), "apiweiser-cli/angular-20.0.0");
  assert.equal(
    commitMessage(group),
    "Migrate @angular packages together (@angular/core, @angular/router)",
  );
});

test("commitMessage lists each package's own versions for a mixed-scope group", () => {
  assert.equal(
    commitMessage([baseUi, dateFns]),
    "Migrate @base-ui/react from 1.3.0 to 1.9.0, date-fns from 3.6.0 to 4.4.0",
  );
});
