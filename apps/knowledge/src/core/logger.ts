// Pino logger — one shared instance for the whole service. Pretty-prints on a
// dev TTY, otherwise emits JSON to stderr. (Lifted from the task-builder api.)

import pino from "pino";

import { config } from "../config/config.ts";

const destination = {
  write(chunk: string): boolean {
    process.stderr.write(chunk);
    return true;
  },
};

const isTTY = !!process.stderr.isTTY;
const isDev = config.runtime.isDev;
const level = config.log.level;

const transport =
  isTTY && isDev
    ? pino.transport({
        target: "pino-pretty",
        options: { colorize: true, translateTime: "HH:MM:ss.l", ignore: "pid,hostname", destination: 2 },
      })
    : destination;

export const rootLogger = pino({ level, base: { app: "knowledge" } }, transport);

export type Logger = pino.Logger;
