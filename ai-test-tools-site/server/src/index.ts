import { createMcpExpressApp, JmeterMcpRuntime, startStdio } from "./jmeterBackend.js";
import { logger } from "./logger.js";

const runtime = new JmeterMcpRuntime();
const mode = process.argv[2] ?? "http";

if (mode.toLowerCase() === "stdio") {
  await startStdio(runtime);
} else {
  const portArg = mode.toLowerCase() === "http" ? process.argv[3] : process.argv[2];
  const port = Number(portArg ?? process.env.PORT ?? 3000);
  const app = createMcpExpressApp(runtime);
  app.listen(port, () => {
    logger.info({ port }, "JMeter MCP TypeScript server started");
    logger.info({ endpoint: `/sse` }, "SSE endpoint ready");
    logger.info({ endpoint: `/messages` }, "Message endpoint ready");
    logger.info({ endpoint: `/rpc` }, "Direct JSON-RPC endpoint ready");
  });
}
