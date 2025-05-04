import type { Page } from "puppeteer";
import type { Logger } from "./logger";
import { LogLevel } from "./types";
import path from "path";

export class ScreenshotService {
  private logger: Logger;
  private screenshotPath: string;

  constructor(logger: Logger, screenshotPath: string) {
    this.logger = logger;
    this.screenshotPath = screenshotPath;
  }

  public async saveScreenshot(page: Page, stage: string): Promise<void> {
    try {
      const screenshotFilename = this.screenshotPath.replace(
        ".png",
        `_${stage}.png`,
      );
      await page.screenshot({ path: screenshotFilename, fullPage: true });
      await this.logger.log(
        `📸 Saved screenshot to ${path.basename(screenshotFilename)}`,
        undefined,
        LogLevel.DEBUG,
      );
    } catch (screenshotError) {
      await this.logger.log(
        `⚠️ Failed to save screenshot (${stage}).`,
        screenshotError,
        LogLevel.WARN,
      );
    }
  }
}
