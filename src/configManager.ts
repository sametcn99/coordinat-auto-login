import * as fs from "fs/promises";
import * as path from "path";
import inquirer from "inquirer";
import type { AppConfig } from "./types"; // Use import type
import { LogLevel } from "./types";
import { Logger } from "./logger"; // Import Logger

export class ConfigManager {
  private configPath: string;
  private logger: Logger; // Add logger instance

  constructor(
    logger: Logger,
    configDir: string = path.dirname(require.main?.filename || process.cwd()),
  ) {
    this.logger = logger; // Store logger instance
    this.configPath = path.join(configDir, "auto-login.config.json");
  }

  /**
   * Loads configuration from the `auto-login.config.json` file.
   * If the file doesn't exist, it prompts the user for configuration details
   * using `inquirer` and saves the answers to the file.
   * @async
   * @returns {Promise<AppConfig>} A promise that resolves with the loaded or newly created configuration.
   * @throws {Error} If the configuration file exists but is invalid or missing required fields.
   * @throws {Error} If there's an error reading or writing the configuration file (other than ENOENT).
   */
  public async loadOrPromptConfig(): Promise<AppConfig> {
    try {
      await this.logger.log(
        `🔍 Checking for configuration file at: ${this.configPath}`,
        undefined,
        LogLevel.DEBUG,
      );
      const data = await fs.readFile(this.configPath, "utf-8");
      await this.logger.log(
        "✅ Configuration file found. Loading settings.",
        undefined,
        LogLevel.INFO,
      );
      const parsedConfig = JSON.parse(data) as AppConfig;

      // Basic validation of loaded config
      if (
        !parsedConfig.WIFI_SSID ||
        !parsedConfig.AUTH_URL ||
        !parsedConfig.TC_NU ||
        !parsedConfig.NAME ||
        !parsedConfig.SURNAME ||
        !parsedConfig.BIRTH_YEAR
      ) {
        throw new Error(
          "❌ Configuration file is missing required fields (WIFI_SSID, AUTH_URL, TC_NU, NAME, SURNAME, BIRTH_YEAR). Please check or delete the file to re-configure.",
        );
      }
      // Ensure LOGIN_INTERVAL_MS has a default if missing
      if (
        typeof parsedConfig.LOGIN_INTERVAL_MS !== "number" ||
        parsedConfig.LOGIN_INTERVAL_MS <= 0
      ) {
        await this.logger.log(
          `LOGIN_INTERVAL_MS missing or invalid in config, using default 5000ms`,
          undefined,
          LogLevel.WARN,
        );
        parsedConfig.LOGIN_INTERVAL_MS = 5000;
      }

      return parsedConfig;
    } catch (error: any) {
      if (error.code === "ENOENT") {
        await this.logger.log(
          "⚠️ Configuration file not found. Prompting user for details...",
          undefined,
          LogLevel.WARN,
        );
        const answers = await inquirer.prompt([
          {
            type: "input",
            name: "WIFI_SSID",
            message: "Enter the Wi-Fi SSID (Network Name):",
            validate: (input) => !!input || "SSID cannot be empty.",
          },
          {
            type: "password", // Use password type for sensitive info
            name: "WIFI_PASSWORD",
            message: "Enter the Wi-Fi Password (leave blank if none):",
            mask: "*",
          },
          {
            type: "input",
            name: "AUTH_URL",
            message:
              "Enter the Captive Portal Authentication URL (e.g., http://192.168.1.1/login):",
            validate: (input) =>
              (!!input && input.startsWith("http")) ||
              "Please enter a valid URL.",
          },
          {
            type: "input",
            name: "TC_NU",
            message: "Enter your Turkish ID Number (TC Kimlik No):",
            validate: (input) =>
              /^\d{11}$/.test(input) ||
              "Please enter a valid 11-digit TC number.",
          },
          {
            type: "input",
            name: "NAME",
            message: "Enter your First Name:",
            validate: (input) => !!input || "Name cannot be empty.",
          },
          {
            type: "input",
            name: "SURNAME",
            message: "Enter your Last Name:",
            validate: (input) => !!input || "Surname cannot be empty.",
          },
          {
            type: "input",
            name: "BIRTH_YEAR",
            message: "Enter your Birth Year (YYYY):",
            validate: (input) =>
              /^\d{4}$/.test(input) || "Please enter a valid 4-digit year.",
          },
          {
            type: "number",
            name: "LOGIN_INTERVAL_MS",
            message:
              "Enter check interval in milliseconds (e.g., 5000 for 5s):",
            default: 5000,
            validate: (input) => {
              // Add check for undefined input
              if (input === undefined || input === null)
                return "Interval cannot be empty.";
              return input > 0 || "Interval must be positive.";
            },
          },
        ]);

        const newConfig: AppConfig = {
          WIFI_SSID: answers.WIFI_SSID,
          WIFI_PASSWORD: answers.WIFI_PASSWORD || undefined, // Store as undefined if blank
          AUTH_URL: answers.AUTH_URL,
          LOGIN_INTERVAL_MS: answers.LOGIN_INTERVAL_MS,
          TC_NU: answers.TC_NU,
          NAME: answers.NAME,
          SURNAME: answers.SURNAME,
          BIRTH_YEAR: answers.BIRTH_YEAR,
        };

        try {
          await fs.writeFile(
            this.configPath,
            JSON.stringify(newConfig, null, 2), // Pretty print JSON
            "utf-8",
          );
          await this.logger.log(
            `✅ Configuration saved to ${this.configPath}`,
            undefined,
            LogLevel.INFO,
          );
          return newConfig;
        } catch (writeError: any) {
          await this.logger.log(
            `❌ Failed to save configuration file to ${this.configPath}`,
            writeError,
            LogLevel.ERROR,
          );
          throw new Error(
            `Failed to save configuration: ${writeError.message}`,
          ); // Re-throw after logging
        }
      } else {
        // Handle other errors like permission issues or invalid JSON
        await this.logger.log(
          `❌ Error reading or parsing configuration file: ${this.configPath}`,
          error,
          LogLevel.ERROR,
        );
        throw new Error(`Failed to load configuration: ${error.message}`); // Re-throw after logging
      }
    }
  }
}
