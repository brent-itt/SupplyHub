import { z } from "zod";
import type { Item } from "./types";

export const requisitionDateSchema = z.iso.date("Enter a valid date.").refine(date => !date.startsWith("0000-"), "Enter a valid date.");

/** Default to the university's calendar date, independent of the server timezone. */
export function universityDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find(value => value.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function matchingSupplyNames<T extends Pick<Item, "name" | "is_archived">>(items: T[], name: string): T[] {
  const normalized = name.trim().toLocaleLowerCase();
  return items.filter(item => !item.is_archived && item.name.trim().toLocaleLowerCase() === normalized);
}

export function formatRequestDate(date: string): string {
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}
