import { TestCaseStore } from "./store.js";

/** 进程内共享的测试用例 Store 单例：路由与生成流程共用，启动引导时由 migrate 接入 MySQL。 */
export const sharedTestCaseStore = new TestCaseStore();
