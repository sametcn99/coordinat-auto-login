import type { Browser, Page } from "puppeteer";
import path from "path";
import type { PortalFormData } from "./types";
import type { Logger } from "./logger";
import { LogLevel } from "./types"; // Import LogLevel as a value
import { BrowserManager } from "./BrowserManager";
import { ScreenshotService } from "./ScreenshotService";
import { FormService } from "./FormService";

export class PortalAuthenticator {
  private logger: Logger;
  private formData: PortalFormData;
  private authUrl: string;
  private browserManager: BrowserManager;
  private screenshotService: ScreenshotService;
  private formService: FormService;
  private readonly screenshotPath = path.join(
    process.cwd(),
    "captive-portal-debug.png",
  );

  constructor(logger: Logger, formData: PortalFormData, authUrl: string) {
    this.logger = logger;
    this.formData = formData;
    this.authUrl = authUrl;
    this.browserManager = new BrowserManager(logger);
    this.screenshotService = new ScreenshotService(logger, this.screenshotPath);
    this.formService = new FormService(logger, formData);
  }

  /**
   * Handles captive portal authentication using Puppeteer.
   * Launches a browser, navigates to a test URL to trigger the portal redirect,
   * attempts to identify the portal page, and then calls `fillCaptivePortalForm`
   * to interact with the login form.
   * Ensures the browser instance is properly closed afterwards.
   * @async
   * @returns {Promise<boolean>} A promise resolving to true if authentication likely succeeded, false otherwise.
   */
  public async authenticate(): Promise<boolean> {
    let success = false;
    await this.logger.log(
      "🤖 Launching browser for portal authentication...",
      undefined,
      LogLevel.INFO,
    );
    let browser: Browser | null = null;
    try {
      browser = await this.browserManager.launchBrowser({
        headless: false,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--ignore-certificate-errors",
          "--disable-extensions",
          "--disable-features=IsolateOrigins,site-per-process,BlockInsecurePrivateNetworkRequests",
          "--allow-running-insecure-content",
        ],
      });
      if (!browser) {
        throw new Error("Failed to launch browser instance.");
      }
      const page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
      );
      page.on("requestfailed", (request) => {
        this.logger.log(
          `❌ Request failed: ${request.url()} - ${request.failure()?.errorText}`,
          `Method: ${request.method()}, ResourceType: ${request.resourceType()}`,
          LogLevel.WARN,
        );
      });
      page.on("pageerror", (error) => {
        this.logger.log(
          `❌ Page JavaScript error: ${error.message}`,
          error.stack,
          LogLevel.WARN,
        );
      });
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          this.logger.log(
            `🖥️ Browser Console Error: ${msg.text()}`,
            undefined,
            LogLevel.DEBUG,
          );
        }
      });
      page.setDefaultNavigationTimeout(30000);
      await this.logger.log(
        `🌐 Navigating to detect captive portal...`,
        undefined,
        LogLevel.DEBUG,
      );
      const alternativeTestUrls = [
        this.authUrl,
        "http://neverssl.com",
        "http://captive.apple.com",
        "http://detectportal.firefox.com/success.txt",
        "http://connectivitycheck.gstatic.com/generate_204",
      ];
      let portalUrlFound: string | null = null;
      let navigationResponse = null;
      for (const testUrl of alternativeTestUrls) {
        if (!testUrl) continue;
        try {
          await this.logger.log(
            `🌐 Trying navigation to: ${testUrl}...`,
            undefined,
            LogLevel.DEBUG,
          );
          navigationResponse = await page.goto(testUrl, {
            waitUntil: "load",
            timeout: 15000,
          });
          const currentUrl = page.url();
          const status = navigationResponse?.status() ?? 0;
          await this.logger.log(
            `➡️ Navigated from ${testUrl}. Current URL: ${currentUrl}, Status: ${status}`,
            undefined,
            LogLevel.DEBUG,
          );
          const isDifferentHost =
            new URL(currentUrl).hostname !== new URL(testUrl).hostname;
          const isLikelyPortal =
            isDifferentHost ||
            currentUrl.includes("login") ||
            currentUrl.includes("auth") ||
            currentUrl.includes("hotspot") ||
            (status !== 204 && testUrl.includes("generate_204")) ||
            (status !== 200 && !testUrl.includes("generate_204"));
          if (isLikelyPortal && currentUrl !== testUrl) {
            await this.logger.log(
              `✅ Possible captive portal detected at URL: ${currentUrl}`,
              undefined,
              LogLevel.INFO,
            );
            portalUrlFound = currentUrl;
            break;
          } else if (status === 200 || status === 204) {
            await this.logger.log(
              `❓ URL ${testUrl} resulted in ${currentUrl} (Status: ${status}). Seems online or not a portal.`,
              undefined,
              LogLevel.DEBUG,
            );
          } else {
            await this.logger.log(
              `❓ URL ${testUrl} resulted in ${currentUrl} (Status: ${status}). Not identified as portal. Trying next...`,
              undefined,
              LogLevel.DEBUG,
            );
          }
        } catch (error: any) {
          const errorMessage = error.message || "Unknown navigation error";
          await this.logger.log(
            `❌ Error navigating to ${testUrl}: ${errorMessage}. Trying next URL...`,
            error.stack,
            LogLevel.WARN,
          );
          if (errorMessage.includes("net::ERR_BLOCKED_BY_CLIENT")) {
            await this.logger.log(
              `🚫 Navigation to ${testUrl} blocked by client (net::ERR_BLOCKED_BY_CLIENT). Check security software.`,
              undefined,
              LogLevel.ERROR,
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      if (!portalUrlFound) {
        await this.logger.log(
          "⚠️ Could not reliably detect the captive portal page. Assuming current page might be it or already online.",
          `Current URL: ${page.url()}`,
          LogLevel.WARN,
        );
        portalUrlFound = page.url();
      }
      await this.logger.log(
        `🎯 Attempting form interaction on page: ${portalUrlFound}`,
        undefined,
        LogLevel.INFO,
      );
      await this.screenshotService.saveScreenshot(page, "before_fill");
      const formSubmitted = await this.formService.fillAndSubmitForm(page);
      if (formSubmitted) {
        await this.logger.log(
          "✅ Form interaction attempted. Waiting for network...",
          undefined,
          LogLevel.INFO,
        );
        await new Promise((resolve) => setTimeout(resolve, 10000));
        success = true;
        await this.screenshotService.saveScreenshot(page, "after_submit");
      } else {
        await this.logger.log(
          "⚠️ Could not find/fill form fields or click submit button.",
          undefined,
          LogLevel.WARN,
        );
        await this.screenshotService.saveScreenshot(page, "fill_failed");
        success = false;
      }
    } catch (error) {
      await this.logger.log(
        "❌ Error during browser authentication process",
        error,
        LogLevel.ERROR,
      );
      success = false;
      // Try to save screenshot on error
      const browser = this.browserManager.getBrowser();
      if (browser) {
        try {
          const pages = await browser.pages();
          const lastPage =
            pages.length > 0 ? pages[pages.length - 1] : undefined;
          if (lastPage) {
            await this.screenshotService.saveScreenshot(lastPage, "on_error");
          }
        } catch (screenshotError) {
          await this.logger.log(
            "⚠️ Failed to save screenshot on error.",
            screenshotError,
            LogLevel.WARN,
          );
        }
      }
    } finally {
      await this.browserManager.closeBrowser();
    }
    return success;
  }

  // Optionally, expose closeBrowser for external/manual use
  public async closeBrowser(): Promise<void> {
    await this.browserManager.closeBrowser();
  }

  /**
   * Attempts to find and click the submit button on the page.
   * Tries multiple common selectors.
   * @param page The Puppeteer Page object.
   * @returns True if a button was clicked, false otherwise.
   */
  private async clickSubmitButton(page: Page): Promise<boolean> {
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button[id*="submit"]',
      'button[name*="submit"]',
      'button:contains("Login")', // Case-insensitive might be needed
      'button:contains("Giriş")',
      'button:contains("Submit")',
      'button:contains("Connect")',
      'button:contains("Accept")',
      'button:contains("Onayla")',
      'a[href*="javascript:void(0)"]', // Links used as buttons
      "a.button",
    ];

    for (const selector of submitSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          await this.logger.log(
            `🖱️ Found submit button with selector: ${selector}`,
            undefined,
            LogLevel.DEBUG,
          );
          // Use evaluate to click in the browser context, potentially more robust
          await page.evaluate((el) => el.click(), element);
          // await element.click(); // Alternative click method
          await element.dispose(); // Clean up element handle
          return true;
        }
      } catch (error: any) {
        // Ignore errors if selector doesn't match, log others
        if (
          !error.message.includes("failed to find element matching selector")
        ) {
          await this.logger.log(
            `⚠️ Error trying selector '${selector}' for submit button: ${error.message}`,
            undefined,
            LogLevel.DEBUG,
          );
        }
      }
    }

    await this.logger.log(
      "❌ Could not find a suitable submit button.",
      undefined,
      LogLevel.WARN,
    );
    return false;
  }

  /**
   * Attempts to find and fill the login form fields on the captive portal page
   * and click the submit button using Puppeteer.
   * Tries multiple common selectors for each field and the submit button.
   * @private
   * @async
   * @param {Page} page - The Puppeteer Page object representing the captive portal page.
   * @returns {Promise<boolean>} A promise resolving to true if the submit button was successfully clicked, false otherwise.
   */
  private async fillAndSubmitForm(page: Page): Promise<boolean> {
    await this.logger.log(
      "📝 Attempting to fill and submit form...",
      undefined,
      LogLevel.DEBUG,
    );
    try {
      // Check for common form fields in captive portals
      const formFieldsFound = {
        idnumber: false,
        name: false,
        surname: false,
        birthyear: false,
      };

      // More comprehensive selectors
      const fieldSelectors = {
        idnumber: [
          "#idnumber",
          'input[name="idnumber"]',
          'input[name*="tc"]',
          'input[name*="kimlik"]',
          'input[placeholder*="TC"]',
          'input[placeholder*="Kimlik"]',
          'input[aria-label*="TC"]',
          'input[aria-label*="Kimlik"]',
          'input[type="text"][name*="user"]',
          'input[type="number"]', // General number input
        ],
        name: [
          "#name",
          'input[name="name"]',
          'input[name*="ad"]',
          'input[name*="first"]',
          'input[placeholder*="Ad"]',
          'input[placeholder*="İsim"]',
          'input[placeholder*="First Name"]',
          'input[aria-label*="Ad"]',
          'input[aria-label*="İsim"]',
          'input[type="text"]:not([name*="user"]):not([name*="pass"])', // Generic text input (less specific)
        ],
        surname: [
          "#surname",
          'input[name="surname"]',
          'input[name*="soyad"]',
          'input[name*="last"]',
          'input[placeholder*="Soyad"]',
          'input[placeholder*="Last Name"]',
          'input[aria-label*="Soyad"]',
          'input[type="text"]:not([name*="user"]):not([name*="pass"])', // Generic text input
        ],
        birthyear: [
          "#birthyear",
          'input[name="birthyear"]',
          'input[name*="yil"]',
          'input[name*="year"]',
          'input[placeholder*="Doğum Yılı"]',
          'input[placeholder*="Birth Year"]',
          'input[placeholder*="YYYY"]',
          'input[aria-label*="Yıl"]',
          'input[aria-label*="Year"]',
          'input[type="number"]',
          'input[type="tel"]', // Sometimes tel is used
        ],
      };

      /** Helper function to try multiple selectors to find and fill a form field. */
      const fillField = async (
        fieldName: keyof typeof formFieldsFound,
        value: string,
      ): Promise<boolean> => {
        await this.logger.log(
          `   -> Looking for field: ${fieldName}`,
          undefined,
          LogLevel.DEBUG,
        );
        for (const selector of fieldSelectors[fieldName]) {
          try {
            const element = await page.$(selector);
            if (element) {
              await this.logger.log(
                `      Found field '${fieldName}' with selector: ${selector}`,
                undefined,
                LogLevel.DEBUG,
              );
              // Clear field before typing (important for some portals)
              // Use triple click to select all text then type
              await element.click({ clickCount: 3 });
              await element.press("Backspace"); // Clear selection
              await element.type(value, { delay: 50 }); // Add slight delay
              formFieldsFound[fieldName] = true;
              await this.logger.log(
                `      Filled '${fieldName}' with value: ${value.substring(0, 3)}...`,
                undefined,
                LogLevel.DEBUG,
              );
              return true; // Field found and filled
            }
          } catch (e: any) {
            await this.logger.log(
              `      Error trying selector '${selector}' for '${fieldName}': ${e.message}`,
              undefined,
              LogLevel.DEBUG,
            );
          }
        }
        await this.logger.log(
          `   -> Field '${fieldName}' not found with any selector.`,
          undefined,
          LogLevel.WARN,
        );
        return false; // Field not found with any selector
      };

      // Fill fields sequentially, waiting briefly between each
      await fillField("idnumber", this.formData.idnumber);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await fillField("name", this.formData.name);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await fillField("surname", this.formData.surname);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await fillField("birthyear", this.formData.birthyear);
      await new Promise((resolve) => setTimeout(resolve, 200)); // Longer wait before submit

      // Wait for potential redirects or page updates
      await this.logger.log(
        "⏳ Waiting briefly after filling fields...",
        undefined,
        LogLevel.DEBUG,
      );
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Replace waitForTimeout

      // Click the submit button
      await this.logger.log(
        "🖱️ Clicking submit button...",
        undefined,
        LogLevel.DEBUG,
      );
      // await new Promise(resolve => setTimeout(resolve, 500)); // Removed redundant wait
      const submitClicked = await this.clickSubmitButton(page); // Assuming clickSubmitButton exists
      // await new Promise(resolve => setTimeout(resolve, 500)); // Removed redundant wait

      if (submitClicked) {
        await this.logger.log(
          "✅ Submit button clicked.",
          undefined,
          LogLevel.DEBUG,
        );
        await new Promise((resolve) => setTimeout(resolve, 3000)); // Replace waitForTimeout (wait longer after click)
        return true;
      } else {
        await this.logger.log(
          "⚠️ Submit button not found or could not be clicked.",
          undefined,
          LogLevel.WARN,
        );
        return false;
      }
    } catch (error) {
      await this.logger.log(
        "❌ Error during form filling/submission",
        error,
        LogLevel.ERROR,
      );
      return false;
    }
  }

  // (Removed duplicate saveScreenshot, now handled by ScreenshotService)

  // (Removed duplicate closeBrowser, now handled by BrowserManager)
}
