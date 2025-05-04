import type { Page } from "puppeteer";
import type { PortalFormData } from "./types";
import type { Logger } from "./logger";
import { LogLevel } from "./types";

export class FormService {
  private logger: Logger;
  private formData: PortalFormData;

  constructor(logger: Logger, formData: PortalFormData) {
    this.logger = logger;
    this.formData = formData;
  }

  public async fillAndSubmitForm(page: Page): Promise<boolean> {
    await this.logger.log(
      "📝 Attempting to fill and submit form...",
      undefined,
      LogLevel.DEBUG,
    );
    try {
      const formFieldsFound = {
        idnumber: false,
        name: false,
        surname: false,
        birthyear: false,
      };
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
          'input[type="number"]',
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
          'input[type="text"]:not([name*="user"]):not([name*="pass"])',
        ],
        surname: [
          "#surname",
          'input[name="surname"]',
          'input[name*="soyad"]',
          'input[name*="last"]',
          'input[placeholder*="Soyad"]',
          'input[placeholder*="Last Name"]',
          'input[aria-label*="Soyad"]',
          'input[type="text"]:not([name*="user"]):not([name*="pass"])',
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
          'input[type="tel"]',
        ],
      };
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
              await element.click({ clickCount: 3 });
              await element.press("Backspace");
              await element.type(value, { delay: 50 });
              formFieldsFound[fieldName] = true;
              await this.logger.log(
                `      Filled '${fieldName}' with value: ${value.substring(0, 3)}...`,
                undefined,
                LogLevel.DEBUG,
              );
              return true;
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
        return false;
      };
      await fillField("idnumber", this.formData.idnumber);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await fillField("name", this.formData.name);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await fillField("surname", this.formData.surname);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await fillField("birthyear", this.formData.birthyear);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await this.logger.log(
        "⏳ Waiting briefly after filling fields...",
        undefined,
        LogLevel.DEBUG,
      );
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await this.logger.log(
        "🖱️ Clicking submit button...",
        undefined,
        LogLevel.DEBUG,
      );
      const submitClicked = await this.clickSubmitButton(page);
      if (submitClicked) {
        await this.logger.log(
          "✅ Submit button clicked.",
          undefined,
          LogLevel.DEBUG,
        );
        await new Promise((resolve) => setTimeout(resolve, 3000));
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

  private async clickSubmitButton(page: Page): Promise<boolean> {
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button[id*="submit"]',
      'button[name*="submit"]',
      'button:contains("Login")',
      'button:contains("Giriş")',
      'button:contains("Submit")',
      'button:contains("Connect")',
      'button:contains("Accept")',
      'button:contains("Onayla")',
      'a[href*="javascript:void(0)"]',
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
          await page.evaluate((el) => el.click(), element);
          await element.dispose();
          return true;
        }
      } catch (error: any) {
        if (!error.message.includes("failed to find element matching selector")) {
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
}
