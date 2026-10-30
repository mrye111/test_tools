/** CDP screencast 直播帧：探索过程中把页面画面推给订阅者（票据 01 后置项落地）。 */

import type { CDPSession, Page } from "playwright";
import { logger } from "../../../logger.js";

export type FrameSink = (data: string) => void;

type ScreencastFrame = { data: string; sessionId: number };

/**
 * 启动 screencast 推帧（jpeg，长边 1280）。失败（假页面/不支持 CDP）静默降级为无直播。
 * 返回停止函数。
 */
export async function startLiveFrames(page: Page, sink: FrameSink): Promise<() => void> {
  let cdp: CDPSession;
  try {
    cdp = await page.context().newCDPSession(page);
  } catch (error) {
    logger.warn({ err: error }, "[automation] 探源直播帧启动失败，降级为无直播画面");
    return () => undefined;
  }
  try {
    cdp.on("Page.screencastFrame", (frame: ScreencastFrame) => {
      // 必须先 ack 再消费，否则浏览器停发后续帧
      void cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => undefined);
      if (frame.data) sink(`data:image/jpeg;base64,${frame.data}`);
    });
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 55,
      maxWidth: 1280,
      maxHeight: 800,
      everyNthFrame: 1,
    });
    return () => {
      void cdp.send("Page.stopScreencast").catch(() => undefined);
      void cdp.detach().catch(() => undefined);
    };
  } catch (error) {
    logger.warn({ err: error }, "[automation] 探源 screencast 配置失败，降级为无直播画面");
    void cdp.detach().catch(() => undefined);
    return () => undefined;
  }
}
