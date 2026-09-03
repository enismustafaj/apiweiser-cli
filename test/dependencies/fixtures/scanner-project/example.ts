import { Command } from "commander";

const app = new Command();
app.name("example").option("-f, --foo <value>", "foo");
