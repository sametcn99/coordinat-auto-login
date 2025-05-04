import type { Browser } from "puppeteer";
import type { Logger } from "./logger";
import { LogLevel } from "./types";
import puppeteer from "puppeteer";

export class BrowserManager {
  private browserInstance: Browser | null = null;
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  public async launchBrowser(launchOptions: object): Promise<Browser> {
    if (this.browserInstance) {
      await this.logger.log(
        "⚠️ Browser instance already exists. Attempting to close it before launching a new one.",
        undefined,
        LogLevel.WARN,
      );
      await this.closeBrowser();
    }
    this.browserInstance = await puppeteer.launch(launchOptions);
    return this.browserInstance;
  }

  public getBrowser(): Browser | null {
    return this.browserInstance;
  }

  public async closeBrowser(): Promise<void> {
    if (this.browserInstance) {
      await this.logger.log(
        "🔍 Closing browser instance...",
        undefined,
        LogLevel.DEBUG,
      );
      try {
        await this.browserInstance.close();
      } catch (closeError) {
        await this.logger.log(
          "❌ Error closing browser instance",
          closeError,
          LogLevel.ERROR,
        );
      } finally {
        this.browserInstance = null;
        await this.logger.log("✅ Browser closed.", undefined, LogLevel.DEBUG);
      }
    }
  }
}
