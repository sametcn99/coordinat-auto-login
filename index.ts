// filepath: c:\Users\samet\SWProjects\coordinat-auto-login\index.ts
// Import necessary modules from the new structure
import { App } from "./src/app"; // Adjust path if needed
import { LogLevel } from "./src/types"; // Import LogLevel if needed for startup logging

// Keep top-level imports if absolutely necessary for global setup,
// but prefer encapsulation within classes.
// import * as os from "os"; // Moved to relevant classes
// import wifi from "node-wifi"; // Moved to WifiManager
// import puppeteer from "puppeteer"; // Moved to PortalAuthenticator
// import * as fs from "fs/promises"; // Moved to Logger, ConfigManager
// import inquirer from "inquirer"; // Moved to ConfigManager
// import type { Ora } from "ora"; // Moved to Logger, App

/**
 * Initializes and starts the AutoLogin application using the new App class.
 * Handles fatal startup errors.
 * @async
 */
async function startApp() {
  console.log(`[${new Date().toISOString()}][INFO] Application starting...`); // Initial console log

  const app = new App();

  try {
    const initialized = await app.init();
    if (initialized) {
      await app.startMonitoring();
    } else {
      console.error(
        `[${new Date().toISOString()}][FATAL] Application failed to initialize. Exiting.`,
      );
      process.exit(1);
    }
  } catch (error) {
    // Log fatal startup errors that might occur outside the App's own logging
    console.error(
      `[${new Date().toISOString()}][FATAL] Critical error during application startup:`,
      error,
    );
    // Attempt to log using the logger if available, otherwise console is the fallback
    // await app.logger?.log("Critical startup error", error, LogLevel.ERROR); // Check if logger exists
    process.exit(1);
  }
}

// Run the async start function
startApp();
