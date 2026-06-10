import { createMcpExpressApp, JmeterMcpRuntime, startStdio } from "./jmeterBackend.js";

const runtime = new JmeterMcpRuntime();
const mode = process.argv[2] ?? "http";

if (mode.toLowerCase() === "stdio") {
  await startStdio(runtime);
} else {
  const portArg = mode.toLowerCase() === "http" ? process.argv[3] : process.argv[2];
  const port = Number(portArg ?? process.env.PORT ?? 3000);
  const app = createMcpExpressApp(runtime);
  app.listen(port, () => {
    console.error(`JMeter MCP TypeScript server started on port ${port}`);
    console.error(`SSE endpoint: http://localhost:${port}/sse`);
    console.error(`Message endpoint: http://localhost:${port}/messages`);
    console.error(`Direct JSON-RPC endpoint: http://localhost:${port}/rpc`);
  });
}
