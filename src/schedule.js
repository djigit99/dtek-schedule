import { chromium } from "playwright"

import {
  checkIsNight,
  createPeriod,
  getCurrentTime,
  loadLastMessage,
  saveLastMessage,
  useSchedule,
} from "./helpers.js"
import {
  GROUP,
  hours,
  PowerState,
  SHUTDOWNS_DATA_MATCHER,
  SHUTDOWNS_PAGE,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  RETRIES_TIMEOUT,
  RETRIES_MAX_COUNT,
} from "./constants.js"
let sendNotificationRetries = 0
let getShutdownsDataRetries = 0

const getShutdownsData = async () => {
  console.log("🌀 Getting shutdowns data...")

  const browser = await chromium.launch({ headless: true })
  // const browser = await chromium.launch({ headless: false, slowMo: 500 })

  try {
    const browserPage = await browser.newPage()
    await browserPage.goto(SHUTDOWNS_PAGE, {
      waitUntil: "load",
    })

    const html = await browserPage.content()
    const match = html.match(SHUTDOWNS_DATA_MATCHER)

    if (!match) {
      throw new Error("not found")
    }

    const data = JSON.parse(match[1])

    const modal = browserPage.locator("#modal-attention");
    let emergencyShutdown = false;
    if (await modal.count() > 0) {
      const isOpen = await modal.evaluate((element) =>
        element.classList.contains("is-open") &&
        element.getAttribute("aria-hidden") === "false"
      );
      if (isOpen) {
        const text = await modal.locator(".m-attention__text").innerText();
        if (text.includes("екстрені відключення електроенергії")) {
          console.log("Знайдено екстрені відключення");
          emergencyShutdown = true;
        } else if (text.includes("діють стабілізаційні відключення")) {
          console.log("Знайдено стабілізаційні відключення");
        } else {
          console.log("нічого не знайдено")
        }
      }
    }

    console.log(JSON.stringify(data, null, 2))
    console.log("✅ Getting shutdowns data finished.")

    return { data: data, emergencyShutdown: emergencyShutdown }
  } catch (error) {
    console.error(`❌ Getting shutdowns data failed: ${error.message}.`)
  } finally {
    await browser.close()
  }

  if (getShutdownsDataRetries < RETRIES_MAX_COUNT) {
    console.log("🌀 Try getting shutdowns data again...")
    await new Promise((resolve) => setTimeout(resolve, RETRIES_TIMEOUT))
    getShutdownsDataRetries++
    return await getShutdownsData()
  }

  throw Error(
    `❌ Getting shutdowns data failed after ${RETRIES_MAX_COUNT} retries.`
  )
}

function generateSchedule({ data, today }) {
  console.log("🌀 Generating schedule...")

  try {
    console.log("group: " + GROUP);
    const hoursStates = data[today][GROUP]
    if (!hoursStates) throw Error(`group ${GROUP} not found`)
    const [schedule, setSchedule] = useSchedule([])

    hours.forEach((hour) => {
      const state = hoursStates[hour + 1]

      switch (state) {
        case PowerState.ON:
          setSchedule(createPeriod({ hour, power: true }))
          break

        case PowerState.OFF:
          setSchedule(createPeriod({ hour, power: false }))
          break

        case PowerState.HALF_ON:
          setSchedule(createPeriod({ hour, endMin: 30, power: true }))
          setSchedule(createPeriod({ hour, startMin: 30, power: false }))
          break

        case PowerState.HALF_OFF:
          setSchedule(createPeriod({ hour, endMin: 30, power: false }))
          setSchedule(createPeriod({ hour, startMin: 30, power: true }))
          break
      }
    })

    console.log("✅ Generating schedule finished.")

    return schedule
  } catch (error) {
    throw Error(`❌ Generating schedule failed: ${error.message}.`)
  }
}

function generateMessage(schedule = [], update) {
  console.log("🌀 Generating message...")

  const isShutdownsExists = schedule.some(({ power }) => !power)
  isShutdownsExists
    ? console.log("🪫 Power shutdowns detected!")
    : console.log("🔋 No power shutdowns!")

  const scheduleText = [
    ...(isShutdownsExists
      ? schedule
        .filter(({ power }) => !power)
        .map(({ begin, end }) => `🪫 <code>${begin} — ${end}</code>`)
      : schedule.map(({ begin, end }) => `🔋 <code>${begin} — ${end}</code>`)),
  ].join("\n")

  const text = [
    `⚡️ <b>Графік відключень на сьогодні:</b>`,
    scheduleText,
    "",
    `📢 <i>${update}</i>`,
    `🤖 <i>${getCurrentTime()}</i>`,
  ].join("\n")

  return { text, scheduleText }
}

function moderateText({ text, scheduleText, emergencyShutdown }) {
  const lastMessage = loadLastMessage() || {}
  const wasEmergencyShutdown = lastMessage.emergencyShutdown
  const isScheduleChanged = lastMessage.scheduleText !== scheduleText

  let modifiedText = text;
  let isEdit = Boolean(lastMessage.message_id) && !isScheduleChanged
  let isReply = Boolean(lastMessage.message_id) && isScheduleChanged

  if (emergencyShutdown === true) {
    modifiedText =
      "🟡 Аварійні відключення. Графіки не діють.\n\n" +
      `🤖 <i>${getCurrentTime()}</i>`;

    isReply = !wasEmergencyShutdown;
    isEdit = Boolean(wasEmergencyShutdown);
  } else if (wasEmergencyShutdown === true) {
    modifiedText =
      "🟢 Аварійні відключення скасовано, повертаємось до графіків\n\n" +
      text;

    isReply = true;
    isEdit = false;
  }

  if (text !== modifiedText) {
    console.log("✅ Text modified")
    console.log("text:\n " + text)
    console.log("modified text:\n " + modifiedText)
  }

  return [modifiedText, isEdit, isReply, lastMessage];
}

async function sendNotification({ text, isEdit, isReply, lastMessage }) {
  if (!TELEGRAM_BOT_TOKEN) throw Error("❌ Missing telegram bot token.")
  if (!TELEGRAM_CHAT_ID) throw Error("❌ Missing telegram chat id.")

  console.log("🌀 Sending notification...")

  try {

    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${isEdit ? "editMessageText" : "sendMessage"
      }`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text,
          parse_mode: "HTML",
          disable_notification: checkIsNight(),
          message_id: isEdit ? lastMessage.message_id : undefined,
          reply_parameters: isReply
            ? {
              message_id: lastMessage.message_id,
              allow_sending_without_reply: true,
            }
            : undefined,
        }),
      }
    )

    const data = await response.json()

    if (data.description?.includes("not modified")) {
      console.log("🟡 Notification not changed.")
      return lastMessage;
    }
    if (!data.ok) throw Error(data.description)

    console.log("🟢 Notification sent.")

    return data.result;
  } catch (error) {
    console.error(`❌ Sending notification failed: ${error.message}.`)

    if (sendNotificationRetries < RETRIES_MAX_COUNT) {
      console.log("🌀 Try sending notification again...")
      await new Promise((resolve) => setTimeout(resolve, RETRIES_TIMEOUT))
      sendNotificationRetries++
      return await sendNotification({ text, isEdit, isReply, lastMessage })
    }

    throw Error(
      `❌ Sending notification failed after ${RETRIES_MAX_COUNT} retries.`
    )
  }
}

async function run() {
  const { data, emergencyShutdown } = await getShutdownsData()

  const groups = data.data?.[data.today] ?? {}
  if (!Object.keys(groups).length) {
    console.log("🔋 No schedule for today.")
    return
  }

  const schedule = generateSchedule(data)
  const { text, scheduleText } = generateMessage(schedule, data.update)
  const [modifiedText, isEdit, isReply, lastMessage] = moderateText({ text, scheduleText, emergencyShutdown });

  const result = await sendNotification({ text: modifiedText, isEdit, isReply, lastMessage });

  saveLastMessage({ date: result.date, message_id: result.message_id, scheduleText, emergencyShutdown })
}

run().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
