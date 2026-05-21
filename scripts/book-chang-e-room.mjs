#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const DEFAULTS = {
  profile: "猎聘",
  timezone: "Asia/Shanghai",
  daysAhead: 3,
  roomName: "嫦娥",
  roomFloor: "F4",
  startClock: "16:00",
  endClock: "18:00",
  summary: "Bagent日会",
  attendeeIds: "ou_6dd9ee4404478ed4a4d3e6a474bc9613",
};

function parseArgs(argv) {
  const args = { dryRun: envFlag("DRY_RUN") };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--date") {
      args.date = argv[++i];
    } else if (arg === "--days-ahead") {
      args.daysAhead = Number(argv[++i]);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function envFlag(name) {
  return /^(1|true|yes)$/i.test(process.env[name] ?? "");
}

function configFromEnv(args) {
  return {
    profile: process.env.LARK_PROFILE || DEFAULTS.profile,
    timezone: process.env.TIMEZONE || DEFAULTS.timezone,
    daysAhead: args.daysAhead || Number(process.env.DAYS_AHEAD || DEFAULTS.daysAhead),
    roomName: process.env.ROOM_NAME || DEFAULTS.roomName,
    roomFloor: process.env.ROOM_FLOOR || DEFAULTS.roomFloor,
    startClock: process.env.START_TIME || DEFAULTS.startClock,
    endClock: process.env.END_TIME || DEFAULTS.endClock,
    summary: process.env.SUMMARY || DEFAULTS.summary,
    attendeeIds: parseCsv(process.env.ATTENDEE_IDS || DEFAULTS.attendeeIds),
    date: args.date || process.env.TARGET_DATE,
    dryRun: args.dryRun,
  };
}

function parseCsv(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function printHelp() {
  console.log(`Usage: node scripts/book-chang-e-room.mjs [--dry-run] [--date YYYY-MM-DD]

Books the F4 Chang'e meeting room three days ahead, 16:00-18:00 Asia/Shanghai by default.

Environment overrides:
  LARK_PROFILE, TIMEZONE, DAYS_AHEAD, TARGET_DATE, ROOM_NAME, ROOM_FLOOR,
  START_TIME, END_TIME, SUMMARY, ATTENDEE_IDS, DRY_RUN
`);
}

function pad(number) {
  return String(number).padStart(2, "0");
}

function getZonedParts(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(value.year),
    month: Number(value.month),
    day: Number(value.day),
    hour: Number(value.hour),
    minute: Number(value.minute),
    second: Number(value.second),
  };
}

function addDaysToDateString(dateString, days) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function todayInTimezone(timezone) {
  const now = getZonedParts(new Date(), timezone);
  return `${now.year}-${pad(now.month)}-${pad(now.day)}`;
}

function parseClock(clock) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock);
  if (!match) throw new Error(`Invalid clock time: ${clock}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error(`Invalid clock time: ${clock}`);
  return { hour, minute };
}

function offsetForLocalDateTime(dateString, clock, timezone) {
  const [year, month, day] = dateString.split("-").map(Number);
  const { hour, minute } = parseClock(clock);
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let instantMs = desiredAsUtc;

  for (let i = 0; i < 4; i += 1) {
    const zoned = getZonedParts(new Date(instantMs), timezone);
    const zonedAsUtc = Date.UTC(
      zoned.year,
      zoned.month - 1,
      zoned.day,
      zoned.hour,
      zoned.minute,
      zoned.second,
    );
    const delta = desiredAsUtc - zonedAsUtc;
    if (delta === 0) break;
    instantMs += delta;
  }

  return Math.round((desiredAsUtc - instantMs) / 60000);
}

function isoWithTimezone(dateString, clock, timezone) {
  const { hour, minute } = parseClock(clock);
  const offsetMinutes = offsetForLocalDateTime(dateString, clock, timezone);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const offset = `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
  return `${dateString}T${pad(hour)}:${pad(minute)}:00${offset}`;
}

function runJson(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  const combined = `${result.stdout || ""}${result.stderr || ""}`.trim();

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit ${result.status}\n${combined}`);
  }
  try {
    return parseFirstJsonObject(combined);
  } catch (error) {
    throw new Error(`Expected JSON from ${command} ${args.join(" ")}\n${combined}\n${error.message}`);
  }
}

function parseFirstJsonObject(text) {
  try {
    return JSON.parse(text);
  } catch {
    // lark-cli dry-run appends a human-readable marker after the JSON payload.
  }

  const start = text.indexOf("{");
  if (start === -1) throw new Error("No JSON object found");

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(text.slice(start, i + 1));
      }
    }
  }

  throw new Error("No complete JSON object found");
}

function larkArgs(config, args) {
  return ["--profile", config.profile, ...args];
}

function hasExistingBooking(config, start, end) {
  const agenda = runJson("lark-cli", larkArgs(config, [
    "calendar",
    "+agenda",
    "--start",
    start,
    "--end",
    end,
    "--format",
    "json",
  ]));
  const events = Array.isArray(agenda.data) ? agenda.data : [];
  return events.some((event) => {
    const text = JSON.stringify(event);
    return text.includes(config.summary) && text.includes(start.slice(0, 16));
  });
}

function floorAliases(floor) {
  const match = /^F?(\d+)$/i.exec(floor || "");
  if (!match) return floor ? [floor] : [];
  return [`F${match[1]}`, `${match[1]}F`, `${match[1]}楼`];
}

function findRoom(config, start, end) {
  const args = [
    "calendar",
    "+room-find",
    "--room-name",
    config.roomName,
    "--slot",
    `${start}~${end}`,
    "--timezone",
    config.timezone,
    "--format",
    "json",
  ];
  if (config.roomFloor) {
    args.push("--floor", config.roomFloor);
  }

  const response = runJson("lark-cli", larkArgs(config, args));
  const rooms = response.data?.time_slots?.[0]?.meeting_rooms || [];
  const aliases = floorAliases(config.roomFloor);
  const exactRoom = rooms.find((room) => {
    const name = room.room_name || "";
    return name.includes(config.roomName) && (aliases.length === 0 || aliases.some((alias) => name.includes(alias)));
  });
  const fallback = rooms.find((room) => (room.room_name || "").includes(config.roomName));

  return exactRoom || fallback || null;
}

function createBooking(config, start, end, room) {
  const attendeeIds = [...new Set([room.room_id, ...config.attendeeIds])];
  const args = [
    "calendar",
    "+create",
    "--summary",
    config.summary,
    "--start",
    start,
    "--end",
    end,
    "--attendee-ids",
    attendeeIds.join(","),
    "--description",
    `Automated reservation for ${room.room_name}. Created by GitHub Actions.`,
    "--format",
    "json",
  ];
  if (config.dryRun) {
    args.push("--dry-run");
  }
  return runJson("lark-cli", larkArgs(config, args));
}

function main() {
  const cliArgs = parseArgs(process.argv.slice(2));
  const config = configFromEnv(cliArgs);
  const targetDate = config.date || addDaysToDateString(todayInTimezone(config.timezone), config.daysAhead);
  const start = isoWithTimezone(targetDate, config.startClock, config.timezone);
  const end = isoWithTimezone(targetDate, config.endClock, config.timezone);

  if (start >= end) {
    throw new Error(`Start must be before end: ${start} >= ${end}`);
  }

  console.log(`Target slot: ${start} - ${end}`);
  console.log(`Room query: ${config.roomFloor ? `${config.roomFloor} ` : ""}${config.roomName}`);
  console.log(`Fixed attendees: ${config.attendeeIds.length}`);
  console.log(`Mode: ${config.dryRun ? "dry-run" : "create"}`);

  if (!config.dryRun && hasExistingBooking(config, start, end)) {
    console.log(`Existing "${config.summary}" booking found for this slot. Skipping.`);
    return;
  }

  const room = findRoom(config, start, end);
  if (!room) {
    throw new Error(`No available room matched ${config.roomFloor ? `${config.roomFloor} ` : ""}${config.roomName} for ${start} - ${end}.`);
  }

  console.log(`Selected room: ${room.room_name} (${room.room_id})`);
  const created = createBooking(config, start, end, room);
  const eventId = created.data?.event_id || created.event_id || created.data?.event?.event_id || "(dry-run)";

  console.log(JSON.stringify({
    ok: true,
    dryRun: config.dryRun,
    eventId,
    start,
    end,
    room: {
      id: room.room_id,
      name: room.room_name,
      capacity: room.capacity,
    },
    fixedAttendees: config.attendeeIds.length,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
