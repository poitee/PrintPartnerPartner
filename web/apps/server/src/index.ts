import { loadConfig } from "./config.js";
import { startServer } from "./app.js";

const config = loadConfig();

startServer(config).catch((err) => {
  console.error(err);
  process.exit(1);
});
