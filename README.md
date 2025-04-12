# coordinat-auto-login

Automatically connects and authenticates to the Coordinat Wi-Fi network.

## Installation

To install dependencies:

```bash
bun install
```

## Configuration

The application uses environment variables for configuration. Create a `.env` file in the root directory with the following variables:

```env
# Wi-Fi Settings
WIFI_SSID=COORDINAT
WIFI_PASSWORD=your_wifi_password_if_needed
AUTH_URL=http://192.168.1.44:5000/Hotspot/Authentication
LOGIN_INTERVAL_MS=5000

# Authentication Information
TC_NO=12345678901
NAME=YourName
SURNAME=YourSurname
BIRTH_YEAR=2000
```

### Environment Variables

| Variable          | Description                                       | Default                                           |
| ----------------- | ------------------------------------------------- | ------------------------------------------------- |
| WIFI_SSID         | The name of the Wi-Fi network to connect to       | COORDINAT                                         |
| WIFI_PASSWORD     | The password for the Wi-Fi network (if required)  | Empty string                                      |
| AUTH_URL          | The URL for captive portal authentication         | <http://192.168.1.44:5000/Hotspot/Authentication> |
| LOGIN_INTERVAL_MS | Interval between connection checks (milliseconds) | 5000 (5 seconds)                                  |
| TC_NO             | National ID Number for authentication             | 12345678901                                       |
| NAME              | First name for authentication                     | YourName                                          |
| SURNAME           | Last name for authentication                      | YourSurname                                       |
| BIRTH_YEAR        | Birth year for authentication                     | 2000                                              |

## Running the Application

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.2.6. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
