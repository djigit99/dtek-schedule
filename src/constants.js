import path from "node:path"

export const SHUTDOWNS_PAGE = "https://www.dtek-krem.com.ua/ua/shutdowns"
export const SHUTDOWNS_DATA_MATCHER = /fact\s*=\s*(\{.*\})/s

const GROUP_PREFIX = "GPV"
export const GROUP = `${GROUP_PREFIX}${process.env.GROUP}`

export const PowerState = Object.freeze({
  ON: "yes",
  OFF: "no",
  HALF_ON: "second",
  HALF_OFF: "first",
})

export const hours = Array.from({ length: 24 }).map((_, i) => i)

export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
export const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID

export const LAST_MESSAGE_FILE = path.resolve("artifacts", `last-message.json`)

export const RETRIES_MAX_COUNT = 5
export const RETRIES_TIMEOUT = 5000
